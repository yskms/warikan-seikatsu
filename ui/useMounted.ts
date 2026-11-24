// この画面が、まだあるか（外れていないか）を持つ ref。
//
// 画面は、`Stack.Protected` のガードの切り替え（セッション切れ・招待URLによる参加確認への切り替え）で、`beforeRemove` を通らずに外れる。
// 外れたあとでも、通信の完了や、開いたままのダイアログ（`Alert`）のコールバックは動く。そのとき、画面を戻す処理（`leave()` の
// `router.back()` / `router.replace()`）が動くと、**そのとき開いている別の画面**（参加確認や、参加後に開いた画面）を戻してしまう。
// 画面を戻す処理と、ダイアログのコールバックから始まる書き込みは、`mounted.current` が真のときだけ動かす。
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
