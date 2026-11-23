// 「このインストールで、アプリを一度起動した」印の実体。`src/services/accountService.ts` の `InstallMarker` を実装する。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
//
// **アプリの削除で消える保存先**（Documentsディレクトリのファイル）に置く。Keychain（`secureStorage.ts`）に置いては
// いけない: 印の目的は、アプリを消して入れ直したとき、Keychainに残ったセッションを捨てることで、Keychainの印は、
// セッションと一緒に残ってしまう。cacheディレクトリにも置かない（OSが、空き容量の不足で消すことがある。消えると、
// 起動のたびではなく、その1回だけ、ログアウトされる）。
// iCloudのバックアップから別の端末へ復元されても、Keychainの項目は `THIS_DEVICE_ONLY` で移らない（`secureStorage.ts`）ので、
// 印が移っても、何も起きない。
//
// `File`・`Paths` は、呼ぶたびに作る（作るときの失敗も、`accountService` の `try` で受ける。起動を止めない）。
import { File, Paths } from 'expo-file-system';

import type { InstallMarker } from '../src/services/accountService.ts';

const MARKER_FILE_NAME = 'install-marker';

export const installMarker: InstallMarker = {
  exists: async () => new File(Paths.document, MARKER_FILE_NAME).exists,
  set: async () => {
    new File(Paths.document, MARKER_FILE_NAME).write('1');
  },
};
