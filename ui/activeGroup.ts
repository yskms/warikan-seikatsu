// いま開くグループ（メモリだけ）。招待に応じて参加したあと、そのグループを開くために使う（`ui/GroupGate.tsx` が見る）。
//
// 複数のグループの切り替えと、最後に開いたグループを覚えること（docs/screens.md 1章）は、まだ作っていない。それまでは、
// `GroupGate` は作成の古い順の先頭を出すので、すでにグループに入っている人が別のグループに参加すると、参加したグループを開けない。
// そこで、参加の直後だけ、参加したグループを開く。**アプリを閉じると忘れる**（次の起動では、また先頭のグループ）。切り替えと
// 「最後に開いたグループを覚える」を作るときに、これを置き換える。
import { useSyncExternalStore } from 'react';

import { createValueStore } from '../src/services/valueStore.ts';

export const activeGroup = createValueStore<string | null>(null);

export function useActiveGroupId(): string | null {
  return useSyncExternalStore(activeGroup.subscribe, activeGroup.get, () => null);
}
