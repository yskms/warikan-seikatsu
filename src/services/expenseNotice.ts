// 支出を登録・編集したあと、ホームへ戻ったときに出すお知らせ（docs/screens.md 4章）。登録した支出の月と、ホームで見ている月が
// 違うとき、「11月分として登録しました」と知らせる（ホームの月は切り替えない）。シート（モーダル）とホームは別の画面なので、
// 受け渡しは、この小さな入れ物で行う（シートが `post`、ホームが、戻ったときに `take`）。RN・Expoには依存しない。

export interface ExpenseNoticeStore {
  /** 保存した支出の登録先の月（`YYYY-MM`）を置く。続けて置くと、最新の1件だけが残る。 */
  post(month: string): void;
  /** 置かれた月を取り出す（取り出すと空になる）。無ければ `null`。 */
  take(): string | null;
}

export function createExpenseNoticeStore(): ExpenseNoticeStore {
  let pending: string | null = null;
  return {
    post(month) {
      pending = month;
    },
    take() {
      const month = pending;
      pending = null;
      return month;
    },
  };
}
