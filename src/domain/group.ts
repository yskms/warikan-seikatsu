// グループ・メンバー・通貨の型と定数。形は docs/backend-design.md 9章の「グループAPI」が正で、Worker（worker/）とは
// コードを共有しない（`worker/src/groups.ts`・`worker/src/currencies.ts`・`worker/src/limits.ts` と揃える。通貨の表は
// `src/domain/group.test.ts` が、Workerの表と食い違っていないかを確かめる）。

export const MEMBER_STATUSES = ['active', 'leaving', 'left', 'deleted'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** メンバーの色のキー（Workerの `MEMBER_COLORS` と同じ並び）。画面は、キーから実際の色に直す。 */
export const MEMBER_COLORS = [
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'brown',
  'gray',
] as const;

export interface Currency {
  code: string;
  /** 画面に出す名前 */
  name: string;
  /** 小数桁数（最小単位への換算に使う。Workerの表と同じ） */
  minorUnit: number;
}

/** 選べる通貨（docs/backend-design.md 2章）。先頭が初期値（日本円）。 */
export const CURRENCIES: readonly Currency[] = [
  { code: 'JPY', name: '日本円', minorUnit: 0 },
  { code: 'USD', name: '米ドル', minorUnit: 2 },
  { code: 'EUR', name: 'ユーロ', minorUnit: 2 },
  { code: 'GBP', name: '英ポンド', minorUnit: 2 },
  { code: 'AUD', name: '豪ドル', minorUnit: 2 },
  { code: 'CAD', name: 'カナダドル', minorUnit: 2 },
  { code: 'CNY', name: '人民元', minorUnit: 2 },
  { code: 'KRW', name: '韓国ウォン', minorUnit: 0 },
];
export const DEFAULT_CURRENCY_CODE = 'JPY';

/** グループ名・表示名の長さの上限（前後の空白を落としたあと、コードポイントで数える。Workerの `limits.ts`）。 */
export const MAX_GROUP_NAME_LENGTH = 30;
export const MAX_DISPLAY_NAME_LENGTH = 20;
/** グループ作成の、グループ名の初期値（docs/screens.md 2章） */
export const DEFAULT_GROUP_NAME = 'ふたりの生活費';

/** `GET /groups` の1件。所属グループの一覧に出る（`active`・`leaving` のグループだけ）。 */
export interface GroupListItem {
  id: string;
  name: string;
  currencyCode: string;
  currencyMinorUnit: number;
  timezone: string;
  createdAt: number;
  memberId: string;
  /** 知らない状態（サーバーが足した値）は `'unknown'`。いまは判断に使わない（`GroupMember.status` と同じ） */
  memberStatus: MemberStatus | 'unknown';
  historyFromMonth: string;
  leaveRequestedMonth: string | null;
  expenseEndMonth: string | null;
}

/** `GET /groups/:id` の `members` の1件。脱退済み・削除済みも含む（名前は残る。docs/backend-design.md 5章）。 */
export interface GroupMember {
  id: string;
  displayName: string;
  /** メンバーの色のキー（`MEMBER_COLORS`）。知らないキーでも読めるよう、文字列で持つ（画面が既定の色にする） */
  color: string;
  /**
   * 知らない状態（サーバーが足した値）は `'unknown'`。**メンバー一覧の表示（「以前のメンバー」への振り分けと状態の文言）にだけ使い、
   * 操作の可否には使わない**（招待できるかは `GroupDetail.canInvite`、脱退が確定したものとして扱うかは `leaveEffective`）。
   * 知らない状態の人は、何も添えず、いる人として出す（`src/services/memberView.ts`）。一覧全体を失敗にしない（CLAUDE.md）。
   * **この値で操作の可否を決める画面（脱退を選ぶ操作など）を作るときは、`'unknown'` の扱い（厳密な検査に戻すか、安全側に
   * 倒すか）を、その画面で決める**（脱退の欄は、自分が `unknown` のときは出さない。`src/services/leaveView.ts`）。
   */
  status: MemberStatus | 'unknown';
  historyFromMonth: string;
  leaveRequestedMonth: string | null;
  expenseEndMonth: string | null;
  /**
   * 脱退が確定したものとして扱うか（サーバーの `isLeaveEffectiveFor`。招待の発行・参加と同じ判定）。`status` が `active` の
   * ままでも、脱退を選んだ月が終わっていれば true（翌月1日のCronが `status` を書くまでの間は、`status` だけでは分からない）。
   * アプリは、月の判定を書き写さず、この値で「脱退予定」の文言と招待の欄を出し分ける。
   */
  leaveEffective: boolean;
  /** 操作している本人か */
  isMe: boolean;
}

/** `GET /groups/:id` の `group`（docs/backend-design.md 9章の「グループAPI」）。 */
export interface GroupDetail {
  id: string;
  name: string;
  currencyCode: string;
  currencyMinorUnit: number;
  timezone: string;
  createdAt: number;
  /** 操作している本人のメンバーID */
  memberId: string;
  /** 通貨を変えられないか（金額に関わるものがある） */
  currencyLocked: boolean;
  /**
   * 自分が脱退を選んで確定したら、グループのデータがすべて消えるか（最後の1人。サーバーの `isLastMember`）。脱退を選ぶ操作の確認で、
   * 「グループを削除して脱退」と警告する。**最後の1人かの規則は、アプリに書き写さない**（人数 `seatedMembers` からは分からない:
   * 脱退が確定して精算を待つ人も、メンバーとして残っている）。
   */
  leaveDeletesGroup: boolean;
  /** 人数の上限で数える人数 */
  seatedMembers: number;
  maxMembers: number;
  /** いま招待を発行できるか */
  canInvite: boolean;
  members: GroupMember[];
}
