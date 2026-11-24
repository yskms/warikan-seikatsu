// 最後に開いたグループのID（docs/screens.md 1章）。次の起動で、そのグループを開くために、この端末に覚える。
// 便利のための記憶なので、読み書きに失敗しても、何も起こさない（先頭のグループが開くだけ）。IDだけでは、グループのデータへ入れない（サーバーが所属を確かめる）ので、平文で置く。
// アカウントごとには分けない: 別のアカウントでログインし直しても、そのIDが所属の一覧に無ければ、`pickGroup` が飛ばす。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// `lastCategory.ts` と同じく Documents に置く（cache は、OSが空き容量の不足で消すことがある）。
import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'last-group.txt';

export async function loadLastGroup(): Promise<string | null> {
  try {
    const file = new File(Paths.document, FILE_NAME);
    if (!file.exists) return null;
    const id = (await file.text()).trim();
    return id === '' ? null : id;
  } catch {
    return null;
  }
}

export async function saveLastGroup(groupId: string): Promise<void> {
  try {
    new File(Paths.document, FILE_NAME).write(groupId);
  } catch {
    // 覚えられなくても、グループは開けている
  }
}
