// 固定費のHTTP（一覧・登録・変更・削除）。Serviceからだけ使う。形は docs/backend-design.md 9章の「固定費API」が正で、
// Worker（worker/）とはコードを共有しない。
//
// - 読み込み（`GET`）は、使う項目を全部検べる。ただし、表示にしか使わない `pausedReason` は、知らない値を許す
//   （`oneOfOrUnknown`）。負担の指定（`split`）は、読めない形でも一覧全体を失敗にせず、`null`（アプリが変えない）にする。
// - 書き込み（`POST`・`PATCH`・`DELETE`）の応答は、**使う項目だけ**を検べる（CLAUDE.md）。登録・変更は、`recurringExpense.id`
//   だけを検べる（JSONでない200を成功と取り違えないための最低限）。`thisMonthSkipped` は案内にしか使わないので、`true` でなければ
//   `false` として読む（崩れていても、サーバーで済んだ操作を失敗に見せない）。削除は204で、本文は読まない。
// - 書き込みが断られたとき（400・403・404・409）は、`RecurringRejectedError`（`AuthError` の `invalid-request`）に、サーバーが
//   返した理由を載せる。画面が「使えないメンバー」「削除できない」などを出し分けるため（`src/services/recurringMessage.ts`）。
import type { SplitRequest } from '../domain/expense.ts';
import {
  RECURRING_PAUSED_REASONS,
  type CreateRecurringRequest,
  type RecurringExpense,
  type RecurringSaved,
  type UpdateRecurringRequest,
} from '../domain/recurring.ts';
import { createApiClient, isOpaqueValue, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { array, bool, id, int, invalid, month, nullableInt, nullableStr, oneOfOrUnknown, record } from './parse.ts';

export type RecurringFetchLike = ApiFetchLike;

/**
 * 書き込みをサーバーが断った（400・403・404・409）。`code` は `invalid-request`。やり直しても同じ結果になる失敗で、
 * 理由（`reason`。サーバーの `error`）によって、画面の案内を変える。値は、形を確かめられたものだけを載せる（無ければ `null`）。
 */
export class RecurringRejectedError extends AuthError {
  readonly status: number;
  /** サーバーの `error`（`conflict`・`member_not_available`・`recurring_expense_in_use` など） */
  readonly reason: string | null;
  /** 400 のとき、直すべき項目（`amountMinor`・`split.amounts` など） */
  readonly field: string | null;
  /** `member_not_available` の、使えないメンバー */
  readonly memberId: string | null;

  constructor(status: number, detail: Partial<Pick<RecurringRejectedError, 'reason' | 'field' | 'memberId'>>) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'RecurringRejectedError';
    this.status = status;
    this.reason = detail.reason ?? null;
    this.field = detail.field ?? null;
    this.memberId = detail.memberId ?? null;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

async function rejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  const data = record(await response.json());
  return new RecurringRejectedError(status, {
    reason: optionalString(data.error),
    field: optionalString(data.field),
    memberId: isOpaqueValue(data.memberId) ? data.memberId : null,
  });
}

/** 負担の指定。読めない形（知らない方法・崩れた形・空の対象）は `null`（アプリは変えない） */
function parseSplit(value: unknown): SplitRequest | null {
  try {
    const data = record(value);
    switch (data.method) {
      case 'category':
        return { method: 'category' };
      case 'equal': {
        const memberIds = array(data.memberIds).map(id);
        return memberIds.length === 0 ? null : { method: 'equal', memberIds };
      }
      case 'ratio': {
        const shares = array(data.shares).map((item) => {
          const row = record(item);
          return { memberId: id(row.memberId), basisPoints: int(row.basisPoints) };
        });
        return shares.length === 0 ? null : { method: 'ratio', shares };
      }
      case 'fixed': {
        const amounts = array(data.amounts).map((item) => {
          const row = record(item);
          return { memberId: id(row.memberId), amountMinor: int(row.amountMinor) };
        });
        return amounts.length === 0 ? null : { method: 'fixed', amounts };
      }
      case 'single':
        return { method: 'single', memberId: id(data.memberId) };
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

function parseRecurring(value: unknown): RecurringExpense {
  const data = record(value);
  const dayOfMonth = int(data.dayOfMonth);
  if (dayOfMonth < 1 || dayOfMonth > 31) invalid();
  return {
    id: id(data.id),
    description: nullableStr(data.description),
    amountMinor: int(data.amountMinor),
    categoryId: id(data.categoryId),
    categoryArchived: bool(data.categoryArchived),
    payerMemberId: id(data.payerMemberId),
    split: parseSplit(data.split),
    dayOfMonth,
    startMonth: month(data.startMonth),
    endMonth: data.endMonth === null ? null : month(data.endMonth),
    pausedAt: nullableInt(data.pausedAt),
    pausedReason: data.pausedReason === null ? null : oneOfOrUnknown(RECURRING_PAUSED_REASONS, data.pausedReason),
  };
}

/** 登録・変更の応答から、固定費の `id` と `thisMonthSkipped` だけを読む（書き込みの応答は、使う項目だけを検べる。CLAUDE.md） */
async function savedRecurring(response: { json(): Promise<unknown> }): Promise<RecurringSaved> {
  const data = record(await response.json());
  return { id: id(record(data.recurringExpense).id), thisMonthSkipped: data.thisMonthSkipped === true };
}

export function createRecurringRepository(
  fetchImpl: RecurringFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /** `GET /groups/:id/recurring-expenses`。止めたもの・終了したものも含む（作った時刻の古い順）。 */
    async list(session: string, groupId: string): Promise<RecurringExpense[]> {
      return client.request(
        'GET',
        `/groups/${encodeURIComponent(groupId)}/recurring-expenses`,
        { session },
        async (response) => array(record(await response.json()).recurringExpenses).map(parseRecurring),
      );
    },

    /**
     * `POST /groups/:id/recurring-expenses`。201（新規）も、同じ `id` の再送の200（保存済みのもの）も、成功。
     * 断られたら `RecurringRejectedError`。
     */
    create(session: string, groupId: string, request: CreateRecurringRequest): Promise<RecurringSaved> {
      return client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/recurring-expenses`,
        { session, json: request, rejected: rejection },
        savedRecurring,
      );
    },

    /** `PATCH /recurring-expenses/:id`。変えるものだけを送る（止める・再開するも同じ）。断られたら `RecurringRejectedError`。 */
    update(session: string, recurringId: string, request: UpdateRecurringRequest): Promise<RecurringSaved> {
      return client.request(
        'PATCH',
        `/recurring-expenses/${encodeURIComponent(recurringId)}`,
        { session, json: request, rejected: rejection },
        savedRecurring,
      );
    },

    /**
     * `DELETE /recurring-expenses/:id`（204）。本文は読まない。一度でも支出を作った固定費は 409 `recurring_expense_in_use` で
     * 断られる。すでに無い固定費は 404（`reason` は `not_found`）。
     */
    async remove(session: string, recurringId: string): Promise<void> {
      await client.request(
        'DELETE',
        `/recurring-expenses/${encodeURIComponent(recurringId)}`,
        { session, rejected: rejection },
        async () => undefined,
      );
    },
  };
}

export type RecurringRepository = ReturnType<typeof createRecurringRepository>;
