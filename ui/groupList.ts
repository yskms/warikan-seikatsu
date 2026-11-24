// 所属グループの一覧の読み直しの合図（`ui/GroupGate.tsx` が、一覧を読み直す）。`GroupGate` は、一覧を開いたときに1回しか読まない。
// 脱退を選んで確定した・グループが消えた（締めずに消えた、を含む）あとは、一覧が変わっている（脱退済みのグループは出ない）ので、
// その画面が `reloadGroups` を呼ぶ。読み直した一覧に、いま開いているグループが無ければ、`GroupGate` が、別のグループか、グループの作成へ回す
// （`src/services/groupChoice.ts` の `pickGroup`）。値はメモリにだけ持つ。
import { useSyncExternalStore } from 'react';

import { createValueStore } from '../src/services/valueStore.ts';

const revision = createValueStore(0);

/** 所属グループの一覧を、もう一度読む（`GroupGate` が応じる）。 */
export function reloadGroups(): void {
  revision.set(revision.get() + 1);
}

/** 読み直しの合図の回数。変わったら、一覧を読み直す。 */
export function useGroupsRevision(): number {
  return useSyncExternalStore(revision.subscribe, revision.get, () => 0);
}
