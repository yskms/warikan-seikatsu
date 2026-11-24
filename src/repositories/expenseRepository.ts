// 支出の一覧のHTTP（GET /groups/:id/expenses?month=）。Serviceからだけ使う。形は docs/backend-design.md 9章の
// 「支出API」が正で、Worker（worker/）とはコードを共有しない。登録・編集・削除は、その画面を作るときに足す（書き込みの
// 応答は、使う項目だけを検べる。CLAUDE.md）。読み込みなので、使う項目を全部検べる（ただし、表示にしか使わない
// `splitMethod` は、知らない値も文字列のまま通す。CLAUDE.md）。
import type { Expense, ExpenseList } from '../domain/month.ts';
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { array, bool, date, id, int, invalid, month, nullableId, nullableStr, record, str } from './parse.ts';

export type ExpenseFetchLike = ApiFetchLike;

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

export function createExpenseRepository(
  fetchImpl: ExpenseFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /** `GET /groups/:id/expenses?month=YYYY-MM`。その月の支出を全件（日付の新しい順）。 */
    async list(session: string, groupId: string, targetMonth: string): Promise<ExpenseList> {
      const path = `/groups/${encodeURIComponent(groupId)}/expenses?month=${month(targetMonth)}`;
      return client.request('GET', path, { session }, async (response) => {
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
  };
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
