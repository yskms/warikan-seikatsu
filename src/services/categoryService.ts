// カテゴリと負担割合（設定。docs/screens.md 6章）の読み込みと書き込み。認証が要る呼び出しは、必ず
// `SessionAccess.withSession` を通す（端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。複数の読み込みは、1回の
// `withSession` の中で並べて走らせる（セッションの読み出しを1回にする）。
//
// 書き込みは、やり直さない（競合などで断られたら、画面が読み直して、もう一度操作してもらう。`categoryMessage.ts`）。
import type { CategoryShares, SavedCategoryShare } from '../domain/categoryShare.ts';
import type { GroupDetail } from '../domain/group.ts';
import type { Category, MonthList } from '../domain/month.ts';
import type {
  CategoryRepository,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../repositories/categoryRepository.ts';
import type { CategorySharesRepository, SaveShareInput } from '../repositories/categorySharesRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { pickShareMonth } from './categoryView.ts';

export interface CategoryServiceDeps {
  groups: GroupRepository;
  months: MonthRepository;
  categories: CategoryRepository;
  shares: CategorySharesRepository;
  access: SessionAccess;
}

/** カテゴリと負担割合の画面に要るデータ。 */
export interface CategorySettingsData {
  /** メンバー・通貨 */
  group: GroupDetail;
  /** 月の切り替え（締めていない月が選べる）。今月 */
  months: MonthList;
  /** 費目（アーカイブしたものも含む。並び順） */
  categories: Category[];
  /** 割合を出している月。締めていない月が無ければ `null` */
  month: string | null;
  /** その月の割合。`month` が `null` のときも `null` */
  shares: CategoryShares | null;
}

export function createCategoryService({ groups, months, categories, shares, access }: CategoryServiceDeps) {
  return {
    /**
     * 画面を開くときの読み込み。出す月は、`preferredMonth`（いま選んでいる月）が選べればそれ、なければ今月など
     * （`pickShareMonth`）。月を切り替えるだけのときは `loadShares`。
     */
    load(groupId: string, preferredMonth: string | null): Promise<CategorySettingsData> {
      return access.withSession(async (session) => {
        const [group, monthList, categoryList] = await Promise.all([
          groups.get(session, groupId),
          months.list(session, groupId),
          categories.list(session, groupId),
        ]);
        const month = pickShareMonth(monthList.months, monthList.currentMonth, preferredMonth);
        const monthShares = month === null ? null : await shares.get(session, groupId, month);
        return { group, months: monthList, categories: categoryList, month, shares: monthShares };
      });
    },

    /** 月を切り替えたときの、その月の割合。 */
    loadShares(groupId: string, month: string): Promise<CategoryShares> {
      return access.withSession((session) => shares.get(session, groupId, month));
    },

    /** その月の負担割合を、置き換える（選んだ月とそれ以降に効く）。 */
    saveShare(
      groupId: string,
      month: string,
      categoryId: string,
      input: SaveShareInput,
    ): Promise<SavedCategoryShare> {
      return access.withSession((session) => shares.put(session, groupId, month, categoryId, input));
    },

    /**
     * 「メンバーが増減した」お知らせを、見直し済みにする。`month` は、画面が割合を見た月（その月で使われている行の印だけが消える）、
     * `through` は、画面が見た最も新しい `memberChangedAt`。割合は変えない。同じ確認を送り直しても同じ結果。
     */
    acknowledgeSharesReset(groupId: string, month: string, through: number): Promise<void> {
      return access.withSession((session) => shares.acknowledgeReset(session, groupId, month, through));
    },

    /**
     * 「全費目を均等にする」。`month`（画面が割合を見ている月）と、それより後で割合の行がある月の、全費目の割合を、メンバー全員での
     * 均等に書き直す（上限額も外す。手で直した割合も上書きする）。同じ操作を送り直しても同じ結果（均等のまま）。
     */
    resetSharesToEqual(groupId: string, month: string): Promise<void> {
      return access.withSession((session) => shares.resetToEqual(session, groupId, month));
    },

    /** 費目を作る。`input.id` は、呼び出し側が最初の1回だけ作り、やり直しでも使い回す。 */
    createCategory(groupId: string, input: CreateCategoryInput): Promise<{ id: string }> {
      return access.withSession((session) => categories.create(session, groupId, input));
    },

    /** 費目を変える（名前・アイコン・色・アーカイブ）。 */
    updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<{ id: string }> {
      return access.withSession((session) => categories.update(session, categoryId, input));
    },

    /** 費目を並べ替える。全費目（アーカイブ済みも含む）を、並べたい順に。 */
    reorderCategories(groupId: string, categoryIds: string[]): Promise<void> {
      return access.withSession((session) => categories.reorder(session, groupId, categoryIds));
    },
  };
}

export type CategoryService = ReturnType<typeof createCategoryService>;
