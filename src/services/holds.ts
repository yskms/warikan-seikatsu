// 「いま、割り込まれたくない処理が、いくつ動いているか」を数える入れ物。招待URLによる参加確認への切り替えを、書き込みの最中だけ
// 遅らせるために使う（`ui/inviteHold.ts`）。値は**メモリだけ**。
//
// `acquire()` で1つ増やし、戻り値の関数で1つ減らす。戻り値は何度呼んでも、減らすのは1回だけ（画面の後始末が、二重に呼ばれても、
// ほかの画面の分まで減らさない）。
import { createValueStore, type ValueStore } from './valueStore.ts';

export interface Holds {
  /** 動いている数。変わったら購読者へ知らせる（`useSyncExternalStore`） */
  readonly count: ValueStore<number>;
  /** 1つ数える。戻り値で手放す（2回目以降は何もしない）。 */
  acquire(): () => void;
}

export function createHolds(): Holds {
  const count = createValueStore(0);
  return {
    count,
    acquire() {
      let released = false;
      count.set(count.get() + 1);
      return () => {
        if (released) return;
        released = true;
        count.set(count.get() - 1);
      };
    },
  };
}
