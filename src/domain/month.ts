// 月の一覧・月の集計（精算）・支出・費目の型。形は docs/backend-design.md 9章の「月締め・精算API」「支出API」
// 「費目・負担割合API」が正で、Worker（worker/）とはコードを共有しない。
import type { ExpenseAllocation } from './expense.ts';

/** 月の一覧の `status`（保存せず、締めと送金の状態から毎回導く。9章の「月の一覧」） */
export const MONTH_STATUSES = ['open', 'skipped', 'unsettled', 'settled'] as const;
export type MonthStatus = (typeof MONTH_STATUSES)[number];
/** 知らない状態（サーバーが足した値）は `'unknown'`。表示にしか使わないので、一覧全体を失敗にしない（CLAUDE.md） */
export type MonthListStatus = MonthStatus | 'unknown';

export interface MonthListItem {
  /** `YYYY-MM` */
  month: string;
  status: MonthListStatus;
}

/** `GET /groups/:id/months`。`months` は古い順。選べる月をアプリで計算しない（この範囲をそのまま使う）。 */
export interface MonthList {
  /** グループのタイムゾーンでのカレンダー上の今月。ホームの初期表示 */
  currentMonth: string;
  months: MonthListItem[];
}

export const TRANSFER_STATUSES = ['pending', 'settled', 'carried'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface MonthMember {
  memberId: string;
  /** 締めた月では、締めた時点の名前 */
  displayName: string;
  paidMinor: number;
  burdenMinor: number;
  differenceMinor: number;
  carriedInMinor: number;
  /** 精算する額（差額 + 繰越） */
  netMinor: number;
}

export interface MonthCategory {
  categoryId: string;
  totalMinor: number;
  /** 負担額が0のメンバーの行は無いことがある */
  burdens: { memberId: string; burdenMinor: number }[];
}

/**
 * 送金。締める前の月（見込み）は、`id` も状態も無い（締めるまで確定しない）。締めた月は、送金ごとに状態つき。
 */
export type MonthTransfer =
  | { kind: 'estimate'; fromMemberId: string; toMemberId: string; amountMinor: number }
  | {
      kind: 'closed';
      id: string;
      fromMemberId: string;
      toMemberId: string;
      amountMinor: number;
      status: TransferStatus;
      canCarry: boolean;
    };

/** 締められない理由（`summary` の `close.reason`。月締めのエラー名と同じ。9章） */
export const CLOSE_BLOCK_REASONS = [
  'forbidden',
  'month_closed',
  'month_skipped',
  'month_not_started',
  'previous_month_not_closed',
  'previous_month_unsettled',
] as const;
export type CloseBlockReason = (typeof CLOSE_BLOCK_REASONS)[number];

/**
 * この月を、いま操作しているメンバーが締められるか。`month` は、先に済ませる月（前の月の2つの理由のとき）。
 * 知らない理由（サーバーが足した値）は `'unknown'`。文言の出し分けにしか使わないので、失敗にしない（CLAUDE.md）。
 */
export type CloseState =
  | { closable: true }
  | { closable: false; reason: CloseBlockReason | 'unknown'; month: string | null };

/** `GET /groups/:id/months/:month/summary`（締めた月は、締めた時点の結果） */
export interface MonthView {
  month: string;
  closed: boolean;
  /** 締めた月だけ */
  closing: { id: string; closedAt: number; closedByMemberId: string; processed: boolean } | null;
  /** その月の支出の総額。繰越を含めない */
  totalMinor: number;
  members: MonthMember[];
  categories: MonthCategory[];
  transfers: MonthTransfer[];
  /** `summary` だけ。締めた月は `month_closed` */
  close: CloseState;
}

export interface Expense {
  id: string;
  /** `YYYY-MM-DD` */
  expenseDate: string;
  /** 登録した月（`YYYY-MM`）。日付の月と違うことがある */
  targetMonth: string;
  description: string | null;
  amountMinor: number;
  categoryId: string;
  payerMemberId: string;
  /** 固定費から作られた支出なら、その固定費のID */
  recurringExpenseId: string | null;
  /**
   * 負担の方法（`category`・`equal`・`ratio`・`fixed`・`single`）。`category` 以外は、この支出だけ負担を変えている。
   * 表示にしか使わない（`category` かどうかだけ）ので、知らない値も文字列のまま持つ（CLAUDE.md）。
   */
  splitMethod: string;
}

/**
 * 編集のシートを開くための、1件の支出の全体。一覧の `Expense` に、負担額（`category` 以外の支出だけ）を足したもの。
 * 一覧（ホーム）は負担額を読まない（読まない項目が崩れても、ホーム全体を失敗にしないため）。
 */
export interface ExpenseDetail extends Expense {
  allocations: ExpenseAllocation[];
  /** その月が締め済みか（締めた月の支出は、読み取り専用で開く） */
  closed: boolean;
}

/** `GET /groups/:id/expenses?month=`。日付の新しい順（同じ日付は登録の新しい順） */
export interface ExpenseList {
  month: string;
  closed: boolean;
  expenses: Expense[];
}

export interface Category {
  id: string;
  name: string;
  /** アイコンのキー。知らないキーは、画面が既定の見た目で出す（サーバーは形だけを見る） */
  icon: string;
  /** 色のキー。同上 */
  color: string;
  sortOrder: number;
  /** アーカイブした費目は、新しい支出では選べないが、過去の支出には名前が要る */
  archived: boolean;
}
