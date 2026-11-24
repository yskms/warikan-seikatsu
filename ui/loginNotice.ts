// ログイン画面の上に出す、一度きりの案内（アカウントの削除の結果など）。メモリだけに持つ（端末には保存しない）。
//
// アカウントを削除すると、端末のセッションが無くなり、ルート（`app/_layout.tsx`）がログイン画面へ切り替える
// （`Stack.Protected` のガード。`src/services/sessionLost.ts`）ので、削除の画面は、結果を受ける前に外れる。画面の中に結果を出す形に
// すると、削除したのに何も伝わらない（ログアウトと見分けがつかない）。そこで、結果の文言をここへ置き、ログイン画面が出す。
// 置くのは、画面が外れるかどうかによらず（外れたあとでも）。ログインが済んだら消す（`app/login.tsx`）。
import { useSyncExternalStore } from 'react';

import { createValueStore } from '../src/services/valueStore.ts';

const store = createValueStore<readonly string[] | null>(null);

/** 案内を置く（1行ずつ。すでにあれば置き換える） */
export function setLoginNotice(lines: readonly string[]): void {
  store.set(lines);
}

/** 案内を消す（ログインが済んだとき） */
export function clearLoginNotice(): void {
  store.set(null);
}

/** ログイン画面の上に出す案内。無ければ `null`。 */
export function useLoginNotice(): readonly string[] | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}
