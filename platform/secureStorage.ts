// セッションの保存先の実体（expo-secure-store）。`src/repositories/sessionRepository.ts` の `SecureStorage` を実装する。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// Singfolio（src/services/index.ts の `secureStorage`）からのコピー（コピー元: singfolio 9aaef21）。
//
// Keychainの項目は、この端末の中でだけ使えて（`THIS_DEVICE_ONLY`。バックアップ・端末の引っ越しで別の端末へ移らない。
// 移った先は、ログアウトの状態から始まる）、端末のロックが解けている間だけ読める。
// expo-secure-store の config plugin は、app.json に足さない。足すと、Androidのバックアップ規則が `<include domain="sharedpref">`
// になり、将来、端末に置くデータ（ローカルDBなど）が、バックアップから外れる。iOSには、使っていないFace IDの文言も足される。
// Androidは、Keystoreの鍵が端末から移らないので、バックアップから戻された値は復号できず、`sessionRepository` が
// `unreadable`（サインインしていない扱い）にする。
import * as SecureStore from 'expo-secure-store';

import type { SecureStorage } from '../src/repositories/sessionRepository.ts';

export const secureStorage: SecureStorage = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};
