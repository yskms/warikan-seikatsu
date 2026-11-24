// 書き込みの最中は、招待URLによる参加確認への切り替えを遅らせる。
//
// 招待を持っているあいだ、ルート（`app/_layout.tsx` の `RootNavigator`）は、ログイン済みの画面を全部外して、参加確認だけを出す。
// `Stack.Protected` による除去は、`beforeRemove` を通らない（セッション切れと同じ。`ui/expense/ExpenseSheet.tsx`）ので、書き込みの
// 最中のシートも外れる。書き込みの完了後に画面を戻す（`leave()`。`router.back()` / `router.replace()`）シートは、外れたあとに完了
// すると、そのとき開いている別の画面（参加確認や、参加後に開いた画面）に対して動いてしまう。支出のシートは、保存の `id` も一緒に
// 捨てられ、結果が分からないまま作り直すことになる。そこで、書き込みの最中の画面は、ここに登録して、**書き込みが終わるまで、
// 切り替えを遅らせる**（招待は、そのあいだ、持ったまま。終わったら、切り替わる）。
//
// **登録するのは、書き込みを行い、完了後に画面を戻す（遷移する）画面**: 支出・月締め・カテゴリ編集のシートと、グループ作成。新しく
// そうした画面を作るときは、`useHoldInviteSwap(通信の最中か)` を呼ぶ。読み込みの最中は、登録しない（外れても、取りこぼすものが
// ない）。**参加確認の画面は、登録しない**（登録すると、参加の通信の最中に、自分が外れる）。
//
// 通信には上限がある（`src/repositories/apiClient.ts` の `DEFAULT_TIMEOUT_MS`）ので、登録が外れずに、招待がいつまでも出ない、
// ということは起きない（画面が消えれば、後始末で手放す）。
import { useEffect, useSyncExternalStore } from 'react';

import { createHolds } from '../src/services/holds.ts';

const holds = createHolds();

/** `active` が真のあいだ、参加確認への切り替えを遅らせる（画面が消えたら、手放す）。 */
export function useHoldInviteSwap(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holds.acquire();
  }, [active]);
}

/** 書き込みの最中の画面があるか（ルートが、参加確認への切り替えを遅らせるために見る）。 */
export function useInviteSwapHeld(): boolean {
  return useSyncExternalStore(
    holds.count.subscribe,
    () => holds.count.get() > 0,
    () => false,
  );
}
