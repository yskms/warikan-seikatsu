// 支出の登録・編集・削除（docs/screens.md 4章）と、そのシートを開くときの読み込み。認証が要る呼び出しは、必ず
// `SessionAccess.withSession` を通す（端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
//
// 登録の識別子（`CreateExpenseRequest.id`）は、呼び出し側（シート）が、開いたときに1回だけ作る。通信が切れて結果が分からない
// ときは、**同じ `id` で**もう一度 `create` を呼ぶ（支出が2件にならない）。
import type { CreateExpenseRequest, UpdateExpenseRequest } from '../domain/expense.ts';
import type { GroupDetail } from '../domain/group.ts';
import type { Category, ExpenseDetail, MonthList } from '../domain/month.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { ExpenseRepository } from '../repositories/expenseRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { SessionAccess } from './accountService.ts';

export interface ExpenseServiceDeps {
  groups: GroupRepository;
  months: MonthRepository;
  expenses: ExpenseRepository;
  categories: CategoryRepository;
  access: SessionAccess;
}

/** シートを開くのに要るデータ。`expense` は、編集で開いたときだけ（見つからなければ `null`）。 */
export interface ExpenseFormData {
  group: GroupDetail;
  months: MonthList;
  categories: Category[];
  expense: ExpenseDetail | null;
}

export interface ExpenseTarget {
  /** 編集する支出のID */
  id: string;
  /** その支出の登録した月（`YYYY-MM`） */
  month: string;
}

export function createExpenseService({ groups, months, expenses, categories, access }: ExpenseServiceDeps) {
  return {
    /**
     * シートを開くときの読み込み。グループ（メンバー・通貨）・月の一覧（登録できる月）・費目は、毎回読み直す（ホームが読んだ
     * 古いデータで、締められた月や脱退したメンバーを選ばせない）。編集のときは、その支出も読む。
     */
    load(groupId: string, target: ExpenseTarget | null): Promise<ExpenseFormData> {
      return access.withSession(async (session) => {
        const [group, monthList, categoryList, expense] = await Promise.all([
          groups.get(session, groupId),
          months.list(session, groupId),
          categories.list(session, groupId),
          target === null ? Promise.resolve(null) : expenses.get(session, groupId, target.month, target.id),
        ]);
        return { group, months: monthList, categories: categoryList, expense };
      });
    },

    /** 登録。`request.id` は、シートを開くたびに1回だけ作った値（上のコメント）。 */
    create(groupId: string, request: CreateExpenseRequest): Promise<{ id: string }> {
      return access.withSession((session) => expenses.create(session, groupId, request));
    },

    update(expenseId: string, request: UpdateExpenseRequest): Promise<{ id: string }> {
      return access.withSession((session) => expenses.update(session, expenseId, request));
    },

    remove(expenseId: string): Promise<void> {
      return access.withSession((session) => expenses.remove(session, expenseId));
    },
  };
}

export type ExpenseService = ReturnType<typeof createExpenseService>;
