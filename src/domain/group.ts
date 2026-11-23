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
  memberStatus: MemberStatus;
  historyFromMonth: string;
  leaveRequestedMonth: string | null;
  expenseEndMonth: string | null;
}
