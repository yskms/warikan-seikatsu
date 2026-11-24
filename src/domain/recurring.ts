// 固定費の型。形は docs/backend-design.md 9章の「固定費API」が正で、Worker（`worker/src/recurring.ts`・`recurringInput.ts`）とは
// コードを共有しない。負担の指定（`SplitRequest`）は、支出の登録と同じ形（`expense.ts`）。
import type { SplitRequest } from './expense.ts';

/** 止めた理由（`pausedReason`）。`manual` は手動、`payer_left` は支払う人の脱退、`member_changed` はメンバーの変化（個別の負担の見直しが要る） */
export const RECURRING_PAUSED_REASONS = ['manual', 'payer_left', 'member_changed'] as const;
export type RecurringPausedReason = (typeof RECURRING_PAUSED_REASONS)[number];

/** 固定費（`GET /groups/:id/recurring-expenses` の1件）。作った時刻の古い順に並ぶ。 */
export interface RecurringExpense {
  id: string;
  description: string | null;
  amountMinor: number;
  categoryId: string;
  /** 費目をアーカイブしているか。止めずに、自動登録だけが見送られている（9章の「固定費API」） */
  categoryArchived: boolean;
  payerMemberId: string;
  /**
   * 負担の指定。**アプリが読めない形（知らない負担の方法・崩れた形）は `null`**（アプリは変えない。金額も変えられない。
   * 一覧全体を失敗にしないため。支出の `originalSplit` の `unsupported` と同じ）。
   */
  split: SplitRequest | null;
  /** 毎月の登録日（1〜31。その月に無い日は月末日） */
  dayOfMonth: number;
  /** `YYYY-MM` */
  startMonth: string;
  /** `YYYY-MM`。終了なしは `null` */
  endMonth: string | null;
  /** 止めた時刻。止まっていなければ `null`（止まっているかは、これで決める） */
  pausedAt: number | null;
  /** 止めた理由。表示にだけ使う（知らない値は `'unknown'`。一覧全体を失敗にしない。CLAUDE.md）。止まっていなければ `null` */
  pausedReason: RecurringPausedReason | 'unknown' | null;
}

/** 登録の本文。`description`・`endMonth` は、無ければ送らない。 */
export interface CreateRecurringRequest {
  /**
   * この登録の識別子（UUID。小文字）。通信が切れて結果が分からないとき、**同じ値で**やり直す（固定費が2件にならない）。
   * シートごとに1回作る（最初の保存で作り、そのシートのあいだ使い回す。docs/backend-design.md 9章の「二重送信」）。
   */
  id: string;
  description?: string;
  amountMinor: number;
  categoryId: string;
  payerMemberId: string;
  split: SplitRequest;
  dayOfMonth: number;
  startMonth: string;
  endMonth?: string;
  /** 金額を入力したときの通貨（グループの通貨と違えば409）。必ず送る */
  currencyCode: string;
}

/** 登録の本文から、識別子を除いたもの（識別子は、登録の手順 `src/services/recurringCreate.ts` が持つ） */
export type NewRecurringRequest = Omit<CreateRecurringRequest, 'id'>;

/** 変更の本文。変えるものだけ（1つ以上）。`description`・`endMonth` は `null` で消す。 */
export interface UpdateRecurringRequest {
  description?: string | null;
  amountMinor?: number;
  categoryId?: string;
  payerMemberId?: string;
  /** 負担の指定を丸ごと置き換える（`category` に戻すと、個別の設定を消す） */
  split?: SplitRequest;
  dayOfMonth?: number;
  startMonth?: string;
  endMonth?: string | null;
  /** `true` で止める、`false` で再開する */
  paused?: boolean;
  /** 金額を送るときに添える */
  currencyCode?: string;
}

/** 登録・変更の結果。`thisMonthSkipped` は、今月の分を作らない記録がいまある（9章の「固定費API」） */
export interface RecurringSaved {
  id: string;
  thisMonthSkipped: boolean;
}
