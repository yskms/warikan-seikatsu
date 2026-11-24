// いま開くグループの決め方（docs/screens.md 1章）。所属グループの一覧（作成の古い順）から、開くものを選ぶ。
// 選び方だけを置く（どこから候補のIDを持ってくるかは、`ui/GroupGate.tsx`）。

/**
 * `candidates` の先頭から順に、一覧にあるIDを探して、そのグループを返す（一覧に無いID・`null` は飛ばす）。どれも一覧に無ければ、
 * 一覧の先頭（作成の古い順）。一覧が空なら `undefined`。
 *
 * 候補は、強い順に渡す（`GroupGate` は、このアプリの起動中に開いた・参加したグループ、端末に覚えている最後に開いたグループ）。
 * 一覧に無いIDを飛ばすのは、覚えていたグループから脱退した・別のアカウントでログインし直した、といったとき（そのIDのグループは、
 * もう開けない）。
 */
export function pickGroup<T extends { id: string }>(
  groups: readonly T[],
  candidates: readonly (string | null)[],
): T | undefined {
  for (const id of candidates) {
    if (id === null) continue;
    const found = groups.find((group) => group.id === id);
    if (found !== undefined) return found;
  }
  return groups[0];
}
