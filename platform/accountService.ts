// サインインの層（`src/services/accountService.ts`）の組み立て。HTTP・セッションの保存・乱数とSHA-256・再インストールの印・
// 各社のサインインを、実機の部品でつなぐ。RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// Singfolio（src/services/index.ts の `getServices`）のうち、アカウントの部分を元にした（コピー元: singfolio 9aaef21）。
//
// - Apple: iOSはネイティブのサインイン（`expo-apple-authentication`。IDトークンを得る）。Androidは Web 経由
//   （Custom Tab。認可コードを得て、IDトークンへの交換はWorkerがする）。どちらか1つだけを組み込む（`accountService` の
//   `idTokenProviders` と `authCodeProviders`）。
// - Google: まだ組み込まない（ネイティブのモジュールとクライアントIDがまだ無い）。`signIn('google')` は `provider-unavailable`。
// - APIの置き場は、`createAuthRepository` の既定（`src/repositories/apiClient.ts` の `API_ORIGIN`。本番のドメインが決まるまで
//   仮の値）のまま。開発でローカルのWorkerに向ける必要が出たら、ここで `options.origin` を渡す（`__DEV__` のときだけ、
//   環境変数で上書きする、など）。Workerは、HTTP（平文）を `localhost`・`127.0.0.1`・`[::1]` のときだけ通す（`worker/src/https.ts`）。
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { createAppleSignInRepository } from '../src/repositories/appleSignInRepository.ts';
import { createAppleWebSignInRepository } from '../src/repositories/appleWebSignInRepository.ts';
import { createAuthRepository } from '../src/repositories/authRepository.ts';
import { createSessionRepository } from '../src/repositories/sessionRepository.ts';
import {
  createAccountService,
  type AccountService,
  type SessionAccess,
} from '../src/services/accountService.ts';
import { authBrowser } from './authBrowser.ts';
import { authCrypto } from './authCrypto.ts';
import { installMarker } from './installMarker.ts';
import { secureStorage } from './secureStorage.ts';

const { access, ...account } = createAccountService({
  auth: createAuthRepository(fetch),
  sessions: createSessionRepository(secureStorage),
  installMarker,
  sha256Base64Url: authCrypto.sha256Base64Url,
  idTokenProviders: Platform.OS === 'ios' ? { apple: createAppleSignInRepository(AppleAuthentication) } : {},
  authCodeProviders: Platform.OS === 'android' ? { apple: createAppleWebSignInRepository(authBrowser) } : {},
  randomVerifier: authCrypto.randomVerifier,
});

/** 画面が使う。セッションの値は渡さない。 */
export const accountService: AccountService = account;

/** APIを呼ぶ層だけが使う（セッションを `Authorization` に付ける）。画面には渡さない。 */
export const sessionAccess: SessionAccess = access;
