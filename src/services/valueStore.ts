// 1つの値を持つ小さな入れ物。値が変わったときに、購読している側へ知らせる（Reactからは `useSyncExternalStore` で使う。
// `ui/usePendingInvite.ts`）。`src/` はNodeのテストから直接実行するので、Reactは import しない。
//
// 値は**メモリにだけ**持つ（端末には保存しない）。アプリのプロセスが終われば消える。

export interface ValueStore<T> {
  /** 今の値（`useSyncExternalStore` の `getSnapshot`。変わっていなければ、同じ値を返す） */
  get(): T;
  /** 値を変える。同じ値（`Object.is`）なら、何もしない（購読者へ知らせない） */
  set(value: T): void;
  /** 値が変わったときの通知を受ける。戻り値で解除する */
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // 受け取る側の失敗で、値を変えた側の処理を止めない
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
