// キーパッドの並び（アプリの設定。docs/screens.md 6章）を、この端末に覚える。サーバーには送らない。
// 便利のための設定なので、読み書きに失敗しても、何も起こさない（初期値のスマホの並びで使えるだけ。`src/services/keypadLayoutPreference.ts`）。
// アカウント・グループごとには分けない（端末の好み。ログインし直しても、グループを替えても変えない）。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// `lastGroup.ts` と同じく Documents に置く（cache は、OSが空き容量の不足で消すことがある）。
import { File, Paths } from 'expo-file-system';

import { createKeypadLayoutPreference } from '../src/services/keypadLayoutPreference.ts';

const FILE_NAME = 'keypad-layout.txt';

/** 覚えた並びと、その選択。画面からは `ui/useKeypadLayout.ts` を通して使う。 */
export const keypadLayoutPreference = createKeypadLayoutPreference({
  async load() {
    const file = new File(Paths.document, FILE_NAME);
    return file.exists ? await file.text() : null;
  },
  async save(layout) {
    new File(Paths.document, FILE_NAME).write(layout);
  },
});
