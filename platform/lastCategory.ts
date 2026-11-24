// 支出の登録で、この端末で前回選んだカテゴリ（docs/screens.md 4章）。グループごとに覚える（カテゴリのIDは、グループごとに別）。
// 便利のための記憶なので、読み書きに失敗しても、何も起こさない（先頭のカテゴリから始まるだけ）。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// `installMarker.ts` と同じく Documents に置く（cache は、OSが空き容量の不足で消すことがある）が、印とは別のファイル。
import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'last-expense-category.json';

async function readAll(): Promise<Record<string, string>> {
  const file = new File(Paths.document, FILE_NAME);
  if (!file.exists) return {};
  const data: unknown = JSON.parse(await file.text());
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

export async function loadLastCategory(groupId: string): Promise<string | null> {
  try {
    const all = await readAll();
    return Object.hasOwn(all, groupId) ? (all[groupId] ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveLastCategory(groupId: string, categoryId: string): Promise<void> {
  try {
    const all = await readAll().catch(() => ({}) as Record<string, string>);
    all[groupId] = categoryId;
    new File(Paths.document, FILE_NAME).write(JSON.stringify(all));
  } catch {
    // 覚えられなくても、登録そのものは済んでいる
  }
}
