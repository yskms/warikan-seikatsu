// カテゴリの並べ替え（docs/screens.md 6章の「カテゴリと負担割合」）の、並びの組み立て。画面（`ui/settings/CategoriesScreen.tsx`）は、
// 押された操作を渡すだけ。送り先は `PUT /groups/:id/categories/order`（`categoryService.reorderCategories`）。
//
// - 画面で並べ替えるのは、**使っている費目だけ**。サーバーには、**アーカイブした費目も含めた全費目**を送る（読んだあとに費目が
//   増えた・知らないIDがある、で合わなければ 409 `categories_changed`）。
// - アーカイブした費目は、並べ替えない。**もとの並びの中の位置**（何番目か）を保ったまま、使っている費目の枠だけを入れ替える
//   （使っている費目を後ろへまとめて、アーカイブした費目を末尾へ寄せない。使わなくしたカテゴリを「また使う」にしたときに、
//   思いがけない位置へ現れない）。
import type { Category } from '../domain/month.ts';

export type MoveDirection = 'up' | 'down';

/**
 * `index` の費目を、1つ上（`up`）・下（`down`）へ動かした並び。端で動かせないとき（先頭の `up`・末尾の `down`・範囲外）は、
 * 同じ並びのコピーを返す。元の配列は変えない。
 */
export function moveCategory(order: readonly string[], index: number, direction: MoveDirection): string[] {
  const next = [...order];
  const target = direction === 'up' ? index - 1 : index + 1;
  if (!Number.isInteger(index) || index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** 並びが違うか（保存・破棄の確認が要るか）。 */
export function isReordered(base: readonly string[], next: readonly string[]): boolean {
  return base.length !== next.length || base.some((categoryId, index) => categoryId !== next[index]);
}

/**
 * サーバーへ送る、全費目の並び。`all` は読み込んだ全費目（並び順。アーカイブしたものも含む）、`activeOrder` は、並べ替えた
 * 使っている費目のID。使っている費目の枠（`all` の中で、アーカイブしていない費目がある位置）を、`activeOrder` の順に
 * 埋め直す。
 *
 * `activeOrder` が、`all` の使っている費目と同じ顔ぶれでないとき（読み込み直しで、費目が増えた・アーカイブした・戻した）は
 * `null`（古い並びのまま送ると、サーバーに断られるか、費目の状態と食い違う）。
 */
export function buildReorderIds(all: readonly Category[], activeOrder: readonly string[]): string[] | null {
  const activeIds = all.filter((category) => !category.archived).map((category) => category.id);
  if (activeIds.length !== activeOrder.length) return null;
  const wanted = new Set(activeOrder);
  if (wanted.size !== activeOrder.length || activeIds.some((categoryId) => !wanted.has(categoryId))) return null;
  let next = 0;
  return all.map((category) => (category.archived ? category.id : activeOrder[next++]!));
}

/**
 * 保存に成功したあとの、画面に持つ費目の並び（読み直さずに、そのまま並び替える）。`ids` は `buildReorderIds` の結果。
 * 並び順の値（`sortOrder`）は、先頭から順に振り直す（サーバーが振る値と同じとは限らないので、画面は並びにだけ使う）。
 *
 * `ids` が、`all` の全費目を1度ずつ含む並びでないとき（送っているあいだに、画面の費目が読み直されて変わった）は、`all` を
 * そのまま返す（足りない項目の費目を作らない。次に読み直したときに、サーバーの並びになる）。
 */
export function applyReorder(all: readonly Category[], ids: readonly string[]): Category[] {
  const byId = new Map(all.map((category) => [category.id, category]));
  if (ids.length !== all.length || byId.size !== all.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
    return [...all];
  }
  return ids.map((categoryId, index) => ({ ...byId.get(categoryId)!, sortOrder: index }));
}
