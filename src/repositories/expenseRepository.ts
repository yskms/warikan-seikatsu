// 支出のHTTP（一覧・1件の取得・登録・編集・削除）。Serviceからだけ使う。形は docs/backend-design.md 9章の「支出API」が正で、
// Worker（worker/）とはコードを共有しない。
//
// - 読み込み（`GET`）は、使う項目を全部検べる（ただし、表示にしか使わない `splitMethod` は、知らない値も文字列のまま通す。
//   CLAUDE.md）。ホームの一覧（`list`）は、負担額（`allocations`）を読まない（編集のシートを開くときだけ `get` が読む）。
// - 書き込み（`POST`・`PATCH`・`DELETE`）の応答は、**使う項目だけ**を検べる（CLAUDE.md）。登録・編集は、`expense.id` だけ
//   （JSONでない200を成功と取り違えないための最低限）。削除は204で、本文は無い（本文は読まない）。
// - 書き込みが断られたとき（400・403・404・409）は、`ExpenseRejectedError`（`AuthError` の `invalid-request`）に、サーバーが
//   返した理由を載せる。画面が「月が締められた」「メンバーが使えない」などを出し分けるため（`src/services/expenseMessage.ts`）。
import type { ExpenseAllocation, CreateExpenseRequest, UpdateExpenseRequest } from '../domain/expense.ts';
import type { Expense, ExpenseDetail, ExpenseList } from '../domain/month.ts';
import { createApiClient, isOpaqueValue, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { array, bool, date, id, int, invalid, month, nullableId, nullableInt, nullableStr, record, str } from './parse.ts';

export type ExpenseFetchLike = ApiFetchLike;

/**
 * 書き込みをサーバーが断った（400・403・404・409）。`code` は `invalid-request`。やり直しても同じ結果になる失敗で、
 * 理由（`reason`。サーバーの `error`）によって、画面の案内を変える。値は、形を確かめられたものだけを載せる（無ければ `null`）。
 */
export class ExpenseRejectedError extends AuthError {
  readonly status: number;
  /** サーバーの `error`（`conflict`・`month_closed`・`month_not_registerable`・`member_not_available` など） */
  readonly reason: string | null;
  /** 400 のとき、直すべき項目（`amountMinor`・`split.shares` など） */
  readonly field: string | null;
  /** `member_not_available` の、使えないメンバー */
  readonly memberId: string | null;
  /** `month_not_registerable` の、登録できる範囲（`YYYY-MM`） */
  readonly from: string | null;
  readonly to: string | null;

  constructor(status: number, detail: Partial<Pick<ExpenseRejectedError, 'reason' | 'field' | 'memberId' | 'from' | 'to'>>) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'ExpenseRejectedError';
    this.status = status;
    this.reason = detail.reason ?? null;
    this.field = detail.field ?? null;
    this.memberId = detail.memberId ?? null;
    this.from = detail.from ?? null;
    this.to = detail.to ?? null;
  }
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

function optionalMonth(value: unknown): string | null {
  return typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null;
}

async function rejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  const data = record(await response.json());
  return new ExpenseRejectedError(status, {
    reason: optionalString(data.error),
    field: optionalString(data.field),
    memberId: isOpaqueValue(data.memberId) ? data.memberId : null,
    from: optionalMonth(data.from),
    to: optionalMonth(data.to),
  });
}

function parseExpense(value: unknown): Expense {
  const data = record(value);
  return {
    id: id(data.id),
    expenseDate: date(data.expenseDate),
    targetMonth: month(data.targetMonth),
    description: nullableStr(data.description),
    amountMinor: int(data.amountMinor),
    categoryId: id(data.categoryId),
    payerMemberId: id(data.payerMemberId),
    recurringExpenseId: nullableId(data.recurringExpenseId),
    // `category` かどうかの判定にしか使わないので、知らない値も文字列のまま通す
    splitMethod: str(data.splitMethod),
  };
}

function parseAllocation(value: unknown): ExpenseAllocation {
  const data = record(value);
  return {
    memberId: id(data.memberId),
    burdenMinor: int(data.burdenMinor),
    shareBasisPoints: nullableInt(data.shareBasisPoints),
  };
}

/** 登録・編集の応答から、保存された支出の `id` だけを読む（書き込みの応答は、使う項目だけを検べる。CLAUDE.md） */
async function savedExpenseId(response: { json(): Promise<unknown> }): Promise<{ id: string }> {
  return { id: id(record(record(await response.json()).expense).id) };
}

export function createExpenseRepository(
  fetchImpl: ExpenseFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  function listPath(groupId: string, targetMonth: string): string {
    return `/groups/${encodeURIComponent(groupId)}/expenses?month=${month(targetMonth)}`;
  }

  return {
    /** `GET /groups/:id/expenses?month=YYYY-MM`。その月の支出を全件（日付の新しい順）。 */
    async list(session: string, groupId: string, targetMonth: string): Promise<ExpenseList> {
      return client.request('GET', listPath(groupId, targetMonth), { session }, async (response) => {
        const data = record(await response.json());
        const list = {
          month: month(data.month),
          closed: bool(data.closed),
          expenses: array(data.expenses).map(parseExpense),
        };
        // 別の月の結果が返ったら、その月の画面に出さない（`monthRepository.summary` と同じ）
        if (list.month !== targetMonth) invalid();
        return list;
      });
    },

    /**
     * 編集のシートを開くための、1件の支出（負担額つき）。1件を返すAPIは無いので、その月の一覧から探す。見つからなければ
     * `null`（別のメンバーに削除された、など）。編集の画面が依存する項目（負担額）は、全部検べる。
     */
    async get(session: string, groupId: string, targetMonth: string, expenseId: string): Promise<ExpenseDetail | null> {
      return client.request('GET', listPath(groupId, targetMonth), { session }, async (response) => {
        const data = record(await response.json());
        if (month(data.month) !== targetMonth) invalid();
        const closed = bool(data.closed);
        for (const item of array(data.expenses)) {
          const expense = parseExpense(item);
          if (expense.id !== expenseId) continue;
          return { ...expense, allocations: array(record(item).allocations).map(parseAllocation), closed };
        }
        return null;
      });
    },

    /**
     * `POST /groups/:id/expenses`。201（新規）も、同じ `id` の再送の200（保存済みの支出）も、成功。
     * 断られたら `ExpenseRejectedError`。
     */
    create(session: string, groupId: string, request: CreateExpenseRequest): Promise<{ id: string }> {
      return client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/expenses`,
        { session, json: request, rejected: rejection },
        savedExpenseId,
      );
    },

    /** `PATCH /expenses/:id`。変えるものだけを送る。断られたら `ExpenseRejectedError`。 */
    update(session: string, expenseId: string, request: UpdateExpenseRequest): Promise<{ id: string }> {
      return client.request(
        'PATCH',
        `/expenses/${encodeURIComponent(expenseId)}`,
        { session, json: request, rejected: rejection },
        savedExpenseId,
      );
    },

    /**
     * `DELETE /expenses/:id`（204）。本文は読まない。断られたら `ExpenseRejectedError`。すでに無い支出（別のメンバーが
     * 先に削除した）は 404 で断られる（`reason` は `not_found`）。
     */
    async remove(session: string, expenseId: string): Promise<void> {
      await client.request(
        'DELETE',
        `/expenses/${encodeURIComponent(expenseId)}`,
        { session, rejected: rejection },
        async () => undefined,
      );
    },
  };
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
