// 開いた招待URLのトークンを、参加の確認が済むまで持っておく入れ物（docs/screens.md 2章の「参加確認」）。
//
// 招待URLで起動した人が未ログインのとき、メインの画面（`Stack.Protected`）には入れず、URLは捨てられる。ログインして
// 参加確認へ進むまでのあいだ、トークンをここに持つ。**メモリだけに持ち、端末には保存しない**: ログイン中にアプリの
// プロセスが終わった場合は、もう一度招待URLを開いてもらう（保存すると、使い終わったトークンの掃除と、別のアカウントで
// ログインし直したときの扱いが要る。トークンは、3日で切れる使い捨て）。
//
// 持つのは1つだけ。新しい招待URLを開いたら、それに置き換える（いま確認中の招待があっても、最後に開いたものを優先する）。
import { createValueStore, type ValueStore } from './valueStore.ts';

export interface PendingInvite extends Pick<ValueStore<string | null>, 'get' | 'subscribe'> {
  /** 招待のトークンを持つ（すでにあれば、置き換える） */
  set(token: string): void;
  /**
   * 持っているトークンが `token` のときだけ、手放す。`token` を指定させるのは、確認の最中に新しい招待URLが開かれたとき、
   * 古い招待の終わりの処理が、新しい招待まで消さないため。
   */
  clear(token: string): void;
}

export function createPendingInvite(): PendingInvite {
  const store = createValueStore<string | null>(null);
  return {
    get: store.get,
    subscribe: store.subscribe,
    set: (token) => store.set(token),
    clear(token) {
      if (store.get() === token) store.set(null);
    },
  };
}
