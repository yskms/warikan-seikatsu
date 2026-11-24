// メンバーと招待（設定。docs/screens.md 6章）の読み込みと書き込み。認証が要る呼び出しは、必ず `SessionAccess.withSession` を通す
// （端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。`access` は、`platform/accountService.ts` の
// `sessionAccess`（通知で包んだもの）を渡す。
//
// 書き込みは、やり直さない（断られたら、画面が読み直して、もう一度操作してもらう。`inviteMessage.ts`）。
//
// 招待を開いて参加する側（`preview`・`join`。参加確認の画面。`joinMessage.ts`）も、同じServiceに置く。
import type { GroupDetail } from '../domain/group.ts';
import type { Invite, InvitePreview, IssuedInvite, JoinedInvite } from '../domain/invite.ts';
import type { Category } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { InviteRepository } from '../repositories/inviteRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { bestEffort } from './bestEffort.ts';

export interface InviteServiceDeps {
  groups: GroupRepository;
  invites: InviteRepository;
  /** 脱退の欄の、固定費の添え書きだけに使う（`MembersData.payerRecurring`） */
  months: MonthRepository;
  categories: CategoryRepository;
  recurring: RecurringRepository;
  access: SessionAccess;
}

/** 脱退の欄の添え書きに要る、固定費とその題を決めるデータ（`recurringView.ts` の `myPayerRecurringTitles`）。 */
export interface PayerRecurringData {
  /** グループの今月（終了した固定費を除くため） */
  currentMonth: string;
  categories: Category[];
  recurring: RecurringExpense[];
}

/** メンバーと招待の画面に要るデータ。 */
export interface MembersData {
  /** メンバー（脱退済み・削除済みも含む）・招待できるか */
  group: GroupDetail;
  /** 自分が発行した、未使用で期限内の招待 */
  invites: Invite[];
  /**
   * 脱退の欄の「自分が支払う人の固定費は、選び直す必要があります」の添え書きに使う。**3つのどれかが読めなければ `null`**
   * （添え書きが出ないだけで、画面は失敗にしない。`bestEffort`。401だけは、投げる）。
   */
  payerRecurring: PayerRecurringData | null;
}

export function createInviteService({ groups, invites, months, categories, recurring, access }: InviteServiceDeps) {
  return {
    /**
     * 画面を開くときの読み込み。グループ（メンバー）と招待の一覧と、脱退の欄の添え書き用の固定費を、1回の `withSession` の中で
     * 並べて読む。
     */
    load(groupId: string): Promise<MembersData> {
      return access.withSession(async (session) => {
        const [group, inviteList, payerRecurring] = await Promise.all([
          groups.get(session, groupId),
          invites.list(session, groupId),
          bestEffort(
            Promise.all([
              months.list(session, groupId),
              categories.list(session, groupId),
              recurring.list(session, groupId),
            ]).then(([monthList, categoryList, recurringList]) => ({
              currentMonth: monthList.currentMonth,
              categories: categoryList,
              recurring: recurringList,
            })),
          ),
        ]);
        return { group, invites: inviteList, payerRecurring };
      });
    },

    /**
     * 招待を1つ発行する。**呼ぶたびに新しい招待ができる**（冪等キーは無い）。トークンは、この応答でしか分からない。結果が分からない
     * 失敗のあとは、招待ができているかもしれないので、画面は一覧を読み直す。
     */
    issue(groupId: string): Promise<IssuedInvite> {
      return access.withSession((session) => invites.create(session, groupId));
    },

    /** 招待を取り消す。すでに取り消し済みでも成功する（送り直してよい）。 */
    revoke(inviteId: string): Promise<void> {
      return access.withSession((session) => invites.revoke(session, inviteId));
    },

    /** 招待URLの内容を確認する（参加はしない）。 */
    preview(token: string): Promise<InvitePreview> {
      return access.withSession((session) => invites.preview(session, token));
    },

    /**
     * 招待に応じて参加する。**送り直してよい**: 結果が分からない失敗のあとに送り直すと、参加が済んでいれば、サーバーが
     * 409 `already_member`（`groupId` つき）で教える（`InviteRejectedError`。`joinMessage.ts` の `classifyJoinFailure`）。
     */
    join(token: string, displayName: string): Promise<JoinedInvite> {
      return access.withSession((session) => invites.join(session, token, displayName));
    },
  };
}

export type InviteService = ReturnType<typeof createInviteService>;
