// ホームが読むデータ（グループ・月の一覧・費目・月の集計・支出）。認証が要る呼び出しは、必ず `SessionAccess.withSession` を
// 通す（端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。`access` は、
// `platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
//
// 読み込みだけ（書き込みは、支出の登録・月締めなどの画面を作るときに、別のServiceへ足す）。複数の読み込みは、1回の
// `withSession` の中で並べて走らせる（セッションの読み出しを1回にする。どれかが 401 なら、層がセッションを捨てて通知する）。
import type { CategoryShares } from '../domain/categoryShare.ts';
import type { GroupDetail } from '../domain/group.ts';
import type { Category, ExpenseList, MonthList, MonthView } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { CategorySharesRepository } from '../repositories/categorySharesRepository.ts';
import type { ExpenseRepository } from '../repositories/expenseRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { bestEffort } from './bestEffort.ts';

export interface HomeServiceDeps {
  groups: GroupRepository;
  months: MonthRepository;
  expenses: ExpenseRepository;
  categories: CategoryRepository;
  /** 月ごとの費目の負担割合。内訳の「割合」と上限額の注記にだけ使う（補助の読み込み） */
  categoryShares: CategorySharesRepository;
  recurring: RecurringRepository;
  access: SessionAccess;
}

/** グループ全体で共通のデータ（月を切り替えても変わらない）。 */
export interface HomeGroupData {
  group: GroupDetail;
  months: MonthList;
  categories: Category[];
  /**
   * 固定費（止まっているもの・終了したものも含む）。ホームの「固定費が止まった」お知らせにだけ使う。**読めなければ `null`**
   * （お知らせが出ないだけで、ホームは失敗にしない。`bestEffort`。401だけは、投げる）。
   */
  recurring: RecurringExpense[] | null;
}

/** 選んだ月のデータ。 */
export interface HomeMonthData {
  summary: MonthView;
  expenses: ExpenseList;
  /**
   * その月の費目の負担割合。内訳の「割合」と上限額の注記にだけ使う。**読めなければ `null`**（割合・注記が出ないだけで、
   * ホームは失敗にしない。参加前の月は403になる。`bestEffort`。401だけは、投げる）。
   */
  shares: CategoryShares | null;
}

export function createHomeService({
  groups,
  months,
  expenses,
  categories,
  categoryShares,
  recurring,
  access,
}: HomeServiceDeps) {
  return {
    /** グループの情報（メンバー）・選べる月の一覧・費目・固定費（お知らせ用。読めなければ `null`）。 */
    loadGroup(groupId: string): Promise<HomeGroupData> {
      return access.withSession(async (session) => {
        const [group, monthList, categoryList, recurringList] = await Promise.all([
          groups.get(session, groupId),
          months.list(session, groupId),
          categories.list(session, groupId),
          bestEffort(recurring.list(session, groupId)),
        ]);
        return { group, months: monthList, categories: categoryList, recurring: recurringList };
      });
    },

    /** 選んだ月の集計（締める前は見込み）と、その月の支出と、費目の負担割合（内訳用。読めなければ `null`）。 */
    loadMonth(groupId: string, month: string): Promise<HomeMonthData> {
      return access.withSession(async (session) => {
        const [summary, expenseList, shares] = await Promise.all([
          months.summary(session, groupId, month),
          expenses.list(session, groupId, month),
          bestEffort(categoryShares.get(session, groupId, month)),
        ]);
        return { summary, expenses: expenseList, shares };
      });
    },
  };
}

export type HomeService = ReturnType<typeof createHomeService>;
