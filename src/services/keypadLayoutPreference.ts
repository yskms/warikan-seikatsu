// キーパッドの並びの設定を、メモリと端末で持つ入れ物（`src/services/keypadLayout.ts`）。端末への読み書きは、`platform/keypadLayout.ts` が
// 渡す（RN・Expoを import しないので、Nodeのテストから実行できる。CLAUDE.md）。
//
// - **メモリが先**: 選んだ並びは、すぐ画面へ反映する（`choose`）。端末へ書くのに失敗しても、何も起こさない（起動中は選んだ並びのまま。
//   次の起動で、初期値に戻るだけ）。便利のための設定で、金額の入力そのものは妨げないため。
// - **起動時の読み込み（`start`）は、1回だけ**。読み込みが終わる前に選ばれていたら、読んだ値を捨てる（古い値で、いま選んだ並びを
//   上書きしない）。読めない・知らない値は、初期値のまま。
import { createValueStore, type ValueStore } from './valueStore.ts';
import { DEFAULT_KEYPAD_LAYOUT, parseKeypadLayout, type KeypadLayout } from './keypadLayout.ts';

export interface KeypadLayoutStorage {
  /** 覚えた文字列。無ければ `null`。読めなければ投げてよい（初期値のままにする） */
  load(): Promise<string | null>;
  /** 覚える。失敗したら投げてよい（何も起こさない） */
  save(value: KeypadLayout): Promise<void>;
}

export interface KeypadLayoutPreference extends Pick<ValueStore<KeypadLayout>, 'get' | 'subscribe'> {
  /** 端末に覚えた並びを読む（最初の1回だけ。何度呼んでもよい）。読み終えたら解決する（失敗は投げない）。 */
  start(): Promise<void>;
  /** 並びを選ぶ。すぐ反映して、端末にも覚える（覚えるのに失敗しても、何も起こさない）。 */
  choose(layout: KeypadLayout): Promise<void>;
}

export function createKeypadLayoutPreference(storage: KeypadLayoutStorage): KeypadLayoutPreference {
  const store = createValueStore<KeypadLayout>(DEFAULT_KEYPAD_LAYOUT);
  let started: Promise<void> | null = null;
  let chosen = false;
  return {
    get: store.get,
    subscribe: store.subscribe,
    start() {
      started ??= (async () => {
        try {
          const text = await storage.load();
          const layout = text === null ? null : parseKeypadLayout(text);
          if (layout !== null && !chosen) store.set(layout);
        } catch {
          // 読めなければ、初期値のまま
        }
      })();
      return started;
    },
    async choose(layout) {
      chosen = true;
      store.set(layout);
      try {
        await storage.save(layout);
      } catch {
        // 覚えられなくても、この起動中は、選んだ並びで使える
      }
    },
  };
}
