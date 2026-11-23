// 「このインストールで、アプリを一度起動した」印の実体。`src/services/accountService.ts` の `InstallMarker` を実装する。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
//
// **アプリの削除で消える保存先**（Documentsディレクトリのファイル）に置く。Keychain（`secureStorage.ts`）に置いては
// いけない: 印の目的は、アプリを消して入れ直したとき、Keychainに残ったセッションを捨てることで、Keychainの印は、
// セッションと一緒に残ってしまう。cacheディレクトリにも置かない（OSが、空き容量の不足で消すことがある。消えると、
// 起動のたびではなく、その1回だけ、ログアウトされる）。
// iCloudのバックアップから別の端末へ復元されても、Keychainの項目は `THIS_DEVICE_ONLY` で移らない（`secureStorage.ts`）ので、
// 印が移っても、何も起きない。
// **Androidでは、「印が無い = インストール直後」は成り立たない。** `filesDir` も、Auto Backupの対象（`allowBackup="true"`。
// `app.json` で変えていない。除外の規則も無い）なので、バックアップから戻すと、印も戻り、確認は飛ばされる。実害は無い
// （Keystoreの鍵が移らず、SecureStoreが復号できない値を消して `none` を返す。`secureStorage.ts`）。Androidで印に頼る
// 処理を足すときは、注意する。
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
