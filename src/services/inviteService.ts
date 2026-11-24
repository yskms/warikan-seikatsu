// メンバーと招待（設定。docs/screens.md 6章）の読み込みと書き込み。認証が要る呼び出しは、必ず `SessionAccess.withSession` を通す
// （端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。`access` は、`platform/accountService.ts` の
// `sessionAccess`（通知で包んだもの）を渡す。
//
// 書き込みは、やり直さない（断られたら、画面が読み直して、もう一度操作してもらう。`inviteMessage.ts`）。
import type { GroupDetail } from '../domain/group.ts';
import type { Invite, IssuedInvite } from '../domain/invite.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { InviteRepository } from '../repositories/inviteRepository.ts';
import type { SessionAccess } from './accountService.ts';

export interface InviteServiceDeps {
  groups: GroupRepository;
  invites: InviteRepository;
  access: SessionAccess;
}

/** メンバーと招待の画面に要るデータ。 */
export interface MembersData {
  /** メンバー（脱退済み・削除済みも含む）・招待できるか */
  group: GroupDetail;
  /** 自分が発行した、未使用で期限内の招待 */
  invites: Invite[];
}

export function createInviteService({ groups, invites, access }: InviteServiceDeps) {
  return {
    /** 画面を開くときの読み込み。グループ（メンバー）と招待の一覧を、1回の `withSession` の中で並べて読む。 */
    load(groupId: string): Promise<MembersData> {
      return access.withSession(async (session) => {
        const [group, inviteList] = await Promise.all([groups.get(session, groupId), invites.list(session, groupId)]);
        return { group, invites: inviteList };
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
  };
}

export type InviteService = ReturnType<typeof createInviteService>;
