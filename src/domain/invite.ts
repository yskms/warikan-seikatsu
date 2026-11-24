// 招待の型。形は docs/backend-design.md 9章の「招待・参加・脱退API」が正で、Worker（`worker/src/invites.ts`）とは
// コードを共有しない。

/** `GET /groups/:id/invites` の1件。自分が発行した、未使用で期限内の招待（トークンは返らない）。 */
export interface Invite {
  id: string;
  /** 有効期限（エポックミリ秒） */
  expiresAt: number;
  createdAt: number;
}

/**
 * 発行した直後の招待。**`token`（平文）が分かるのは、この応答だけ**（サーバーはハッシュだけを持つ）。URLを共有し損ねたら、
 * あとから出し直せない（取り消して、新しく発行する）。
 */
export interface IssuedInvite {
  id: string;
  token: string;
}

/**
 * `GET /invites/:token`（招待内容の確認）の結果。開いただけでは何も変わらない。
 * - `alreadyMember: true`: すでにそのグループに参加中（招待の状態によらない）。グループを開くだけにする。
 * - `alreadyMember: false`: まだ参加していない。`groupFull` は、いま参加すると満員で断られるか（人数の数え方はサーバーの
 *   判定で、アプリは書き写さない）。
 */
export type InvitePreview =
  | { alreadyMember: true; groupId: string }
  | { alreadyMember: false; groupName: string; invitedByDisplayName: string; groupFull: boolean };

/** `POST /invites/:token/join` の結果。使うのは、参加したグループの `groupId` だけ。 */
export interface JoinedInvite {
  groupId: string;
}
