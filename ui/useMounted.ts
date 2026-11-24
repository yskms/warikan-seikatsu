// この画面が、まだあるか（外れていないか）を持つ ref。
//
// 画面は、`Stack.Protected` のガードの切り替え（セッション切れ・招待URLによる参加確認への切り替え）で、`beforeRemove` を通らずに外れる。
// 外れたあとでも、通信の完了や、開いたままのダイアログ（`Alert`）のコールバックは動く。そのとき、画面を戻す処理（`leave()` の
// `router.back()` / `router.replace()`）が動くと、**そのとき開いている別の画面**（参加確認や、参加後に開いた画面）を戻してしまう。
// 画面を戻す処理と、ダイアログのコールバックから始まる書き込みは、`mounted.current` が真のときだけ動かす（見えない画面の支出・
// 送金・招待を、確認したときの状態のまま、処理しない）。対象: 支出・月締め・カテゴリ編集・固定費の編集のシート、グループ作成、ホームの精算完了・繰越
// （`ui/home/useTransferActions.ts`）、メンバーと招待の取り消し。**ログアウトの確認（`ui/useSignOut.ts`）は、対象にしない**:
// アカウントの操作として明示的に押されたもので、ログイン画面へ戻るだけ（招待は持ったまま。データは消えない）。
// 書き込みの最中に外れること自体は、`ui/inviteHold.ts` で、招待URLによる切り替えだけ遅らせて防ぐ（セッション切れは遅らせない）。
import { useEffect, useRef, type RefObject } from 'react';

export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    // 開発中の再実行（Fast Refresh）でも、後始末のあとに、また真に戻す
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
