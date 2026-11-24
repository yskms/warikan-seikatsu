// 固定費の一覧・登録・変更・削除（docs/screens.md 6章の「固定費」）と、その画面を開くときの読み込み。認証が要る呼び出しは、必ず
// `SessionAccess.withSession` を通す（端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
//
// 登録の識別子（`CreateRecurringRequest.id`）は、呼び出し側（シート）が、シートごとに1回だけ作る（最初の保存で作り、そのシートの間は
// 使い回す）。通信が切れて結果が分からないときは、**同じ `id` で**もう一度 `create` を呼ぶ（固定費が2件にならない）。
// 書き込みは、やり直さない（競合などで断られたら、画面が案内して、もう一度操作してもらう）。
import type { GroupDetail } from '../domain/group.ts';
import type { Category, MonthList } from '../domain/month.ts';
import type {
  CreateRecurringRequest,
  RecurringExpense,
  RecurringSaved,
  UpdateRecurringRequest,
} from '../domain/recurring.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';

export interface RecurringServiceDeps {
  groups: GroupRepository;
  months: MonthRepository;
  categories: CategoryRepository;
  recurring: RecurringRepository;
  access: SessionAccess;
}

/** 固定費の一覧と、編集のシートに要るデータ。毎回読み直す（古いデータで、使えないメンバーや、使わない設定のカテゴリを選ばせない）。 */
export interface RecurringData {
  /** メンバー・通貨 */
  group: GroupDetail;
  /** 今月と、締めた月（最初に作る月を決める） */
  months: MonthList;
  /** カテゴリ（アーカイブしたものも含む。並び順） */
  categories: Category[];
  /** 固定費（止めたもの・終了したものも含む。作った時刻の古い順） */
  recurring: RecurringExpense[];
}

export function createRecurringService({ groups, months, categories, recurring, access }: RecurringServiceDeps) {
  return {
    /** 画面を開くときの読み込み。4つを、1回の `withSession` の中で並べて走らせる（セッションの読み出しを1回にする）。 */
    load(groupId: string): Promise<RecurringData> {
      return access.withSession(async (session) => {
        const [group, monthList, categoryList, recurringList] = await Promise.all([
          groups.get(session, groupId),
          months.list(session, groupId),
          categories.list(session, groupId),
          recurring.list(session, groupId),
        ]);
        return { group, months: monthList, categories: categoryList, recurring: recurringList };
      });
    },

    /** 登録。`request.id` は、シートごとに1回だけ作った値（上のコメント）。 */
    create(groupId: string, request: CreateRecurringRequest): Promise<RecurringSaved> {
      return access.withSession((session) => recurring.create(session, groupId, request));
    },

    /** 変更。止める・再開するも、これ（`paused`）。 */
    update(recurringId: string, request: UpdateRecurringRequest): Promise<RecurringSaved> {
      return access.withSession((session) => recurring.update(session, recurringId, request));
    },

    remove(recurringId: string): Promise<void> {
      return access.withSession((session) => recurring.remove(session, recurringId));
    },
  };
}

export type RecurringService = ReturnType<typeof createRecurringService>;
