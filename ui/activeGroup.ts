// いま開くグループ（docs/screens.md 1章）。`ui/GroupGate.tsx` が見て、所属の一覧から開くグループを決める。
//
// - **メモリ（`activeGroup`）**: このアプリの起動中に、切り替えた・参加したグループ。端末に覚えているものより優先する
//   （覚えるのに失敗しても、起動中は、選んだグループのままにする）。
// - **端末（`platform/lastGroup.ts`）**: 最後に開いたグループ。次の起動で、メモリが空のあいだ、これを開く。
// 書くのは `openGroup` だけ（切り替えのシートと、参加確認の画面が使う）。どちらにも無い、または一覧に無いときは、作成の古い順の
// 先頭（`src/services/groupChoice.ts`）。
import { useSyncExternalStore } from 'react';

import { saveLastGroup } from '../platform/lastGroup.ts';
import { createValueStore } from '../src/services/valueStore.ts';

export const activeGroup = createValueStore<string | null>(null);

export function useActiveGroupId(): string | null {
  return useSyncExternalStore(activeGroup.subscribe, activeGroup.get, () => null);
}

/** グループを開く（切り替え・参加）。メモリに置いて画面を切り替え、次の起動のために端末にも覚える（覚えるのに失敗しても、何も起こさない）。 */
export function openGroup(groupId: string): void {
  activeGroup.set(groupId);
  void saveLastGroup(groupId);
}
