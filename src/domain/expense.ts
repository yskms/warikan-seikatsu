// 支出の登録・編集の入出力の型。形は docs/backend-design.md 9章の「支出API」が正で、Worker（`worker/src/expenseInput.ts`）とは
// コードを共有しない。一覧に出す支出の型（`Expense`）は `month.ts`。

/** 負担の指定（`split`）。`category` は、費目の割合で分ける（既定）。 */
export type SplitRequest =
  | { method: 'category' }
  | { method: 'equal'; memberIds: string[] }
  | { method: 'ratio'; shares: { memberId: string; basisPoints: number }[] }
  | { method: 'fixed'; amounts: { memberId: string; amountMinor: number }[] }
  | { method: 'single'; memberId: string };

/** 登録の本文。`description` は、無ければ送らない。 */
export interface CreateExpenseRequest {
  /**
   * この登録の識別子（UUID。小文字）。通信が切れて結果が分からないとき、**同じ値で**やり直す（支出が2件にならない）。
   * シートごとに1回作る（最初の保存で作り、そのシートのあいだ使い回す。シートを開き直せば、新しい値）。成功したあとの新しい登録には、
   * 新しい値を使う（docs/backend-design.md 9章の「二重送信」）。
   */
  id: string;
  /** `YYYY-MM-DD` */
  expenseDate: string;
  /** `YYYY-MM` */
  targetMonth: string;
  description?: string;
  amountMinor: number;
  categoryId: string;
  payerMemberId: string;
  split: SplitRequest;
  /** 金額を入力したときの通貨（グループの通貨と違えば409）。必ず送る（docs/backend-design.md 2章） */
  currencyCode: string;
}

/** 編集の本文。変えるものだけ（1つ以上）。`description` は `null` で消す。金額を送るときは `currencyCode` も添える。 */
export interface UpdateExpenseRequest {
  expenseDate?: string;
  targetMonth?: string;
  description?: string | null;
  amountMinor?: number;
  categoryId?: string;
  payerMemberId?: string;
  /** 負担額を丸ごと置き換える。`category` 以外の支出の金額を変えるときは、必ず添える（無ければ400） */
  split?: SplitRequest;
  currencyCode?: string;
}

/** 支出の負担額（`category` 以外の支出だけ。`category` は `[]`） */
export interface ExpenseAllocation {
  memberId: string;
  burdenMinor: number;
  /** 割合指定（`ratio`）のときだけ（1万分率） */
  shareBasisPoints: number | null;
}
