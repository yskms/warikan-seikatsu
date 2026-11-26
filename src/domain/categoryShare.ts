// 月ごとの費目の負担割合の型。形は docs/backend-design.md 9章の「費目・負担割合API」が正で、Worker（worker/）とは
// コードを共有しない。割合は1万分率の整数（合計10000）、上限額は通貨の最小単位の整数（浮動小数点で持たない）。

/** 割合の合計（1万分率）。Workerの `BASIS_POINTS_TOTAL` と同じ */
export const BASIS_POINTS_TOTAL = 10_000;

export interface MemberShare {
  memberId: string;
  basisPoints: number;
}

/** 上限額つきの負担（上限まで `memberId` が負担し、超えた分を `shares` で分ける。3章） */
export interface ShareCap {
  memberId: string;
  capMinor: number;
}

/**
 * 見直しの印（`memberChangedAt`）が付いた理由（サーバーの `member_changed_kind`）。表示（お知らせの文言と、出す操作）にしか使わない。
 * - `reset`: メンバーの増減で、割合を均等に戻した。
 * - `joined`: 2人以上のグループに参加があり、今の割合を残して、新しいメンバーを0%で足した。
 * - `unknown`: アプリが知らない値（サーバーが種類を足したとき。`reset` と同じに扱う）。
 */
export type ShareChangeKind = 'reset' | 'joined' | 'unknown';

/** その月の、1つの費目の負担割合 */
export interface CategoryShareRule {
  categoryId: string;
  /** その月の割合が書かれている月（その月以前で最も新しい行）。表示にしか使わない */
  sourceMonth: string;
  shares: MemberShare[];
  cap: ShareCap | null;
  archived: boolean;
  /**
   * メンバーの増減で、この割合を均等に戻した時刻（Unixエポックのミリ秒）。まだ誰も見直していなければ入る（割合を保存した・
   * 見直しの確認をしたら `null`）。ホームのお知らせ「メンバーが増減した」の元（`buildSharesResetNotice`）。
   */
  memberChangedAt: number | null;
  /**
   * `memberChangedAt` の理由。印が無ければ `null`。古いサーバーが返さないときも `null`（表示にしか使わないので、必須にしない。
   * 印があって種類が `null` なら、`reset` と同じに扱う）。
   */
  memberChangeKind: ShareChangeKind | null;
}

/** `GET /groups/:id/months/:month/category-shares` */
export interface CategoryShares {
  month: string;
  /** 締めた月か */
  closed: boolean;
  /** 保存の入口を出してよいか（締めていない、直せる月、脱退が確定していない） */
  editable: boolean;
  /** その月の割合に入るメンバー（割合を送るとき、全員を送る） */
  memberIds: string[];
  categories: CategoryShareRule[];
}

/** `PUT .../category-shares/:categoryId` の応答のうち、使う項目 */
export interface SavedCategoryShare {
  /** この月より後に別の行があり、書き換えなかった月（`YYYY-MM`） */
  overriddenMonths: string[];
}
