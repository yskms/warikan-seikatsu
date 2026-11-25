// サインインの層（`src/services/accountService.ts`）の組み立て。HTTP・セッションの保存・乱数とSHA-256・再インストールの印・
// 各社のサインインを、実機の部品でつなぐ。RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// Singfolio（src/services/index.ts の `getServices`）のうち、アカウントの部分を元にした（コピー元: singfolio 9aaef21）。
//
// - Apple: iOSはネイティブのサインイン（`expo-apple-authentication`。IDトークンを得る）。Androidは Web 経由
//   （Custom Tab。認可コードを得て、IDトークンへの交換はWorkerがする）。どちらか1つだけを組み込む（`accountService` の
//   `idTokenProviders` と `authCodeProviders`）。
// - Google: 両OSで、自作のExpoモジュール（`modules/warikan-google-signin`。Googleの公式SDKだけを使う）でIDトークンを得る。
//   クライアントIDは `app.json` の `plugins`（`plugins/withGoogleSignIn.js`）で、ネイティブの設定に入る。ネイティブ側が無いビルドでも、
//   import では落ちず、呼んだときに `provider-unavailable` になる。
// - APIの置き場は、`createAuthRepository` の既定（`src/repositories/apiClient.ts` の `API_ORIGIN`。本番のドメイン）のまま。開発でローカルのWorkerに向ける必要が出たら、ここで `options.origin` を渡す（`__DEV__` のときだけ、
//   環境変数で上書きする、など）。Workerは、HTTP（平文）を `localhost`・`127.0.0.1`・`[::1]` のときだけ通す（`worker/src/https.ts`）。
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { createAppleSignInRepository } from '../src/repositories/appleSignInRepository.ts';
import { createAppleWebSignInRepository } from '../src/repositories/appleWebSignInRepository.ts';
import { createAuthRepository } from '../src/repositories/authRepository.ts';
import { createGoogleSignInRepository } from '../src/repositories/googleSignInRepository.ts';
import { createSessionRepository } from '../src/repositories/sessionRepository.ts';
import {
  createAccountService,
  type AccountService,
  type SessionAccess,
} from '../src/services/accountService.ts';
import { withSessionLostNotice } from '../src/services/sessionLost.ts';
import { signInWithGoogle } from '../modules/warikan-google-signin/index.ts';
import { authBrowser } from './authBrowser.ts';
import { authCrypto } from './authCrypto.ts';
import { installMarker } from './installMarker.ts';
import { secureStorage } from './secureStorage.ts';

const { access, ...account } = createAccountService({
  auth: createAuthRepository(fetch),
  sessions: createSessionRepository(secureStorage),
  installMarker,
  sha256Base64Url: authCrypto.sha256Base64Url,
  idTokenProviders: {
    google: createGoogleSignInRepository({ signInWithGoogle }),
    ...(Platform.OS === 'ios' ? { apple: createAppleSignInRepository(AppleAuthentication) } : {}),
  },
  authCodeProviders: Platform.OS === 'android' ? { apple: createAppleWebSignInRepository(authBrowser) } : {},
  randomVerifier: authCrypto.randomVerifier,
});

// 端末のセッションが無くなったこと（401・ログアウト・アカウントの削除）を、画面のログイン状態へ知らせるため、包む
// （`src/services/sessionLost.ts`）。画面・APIを呼ぶ層は、これを通して使う（個別に通知しない）。
const notifier = withSessionLostNotice(account, access);

/** 画面が使う。セッションの値は渡さない。 */
export const accountService: AccountService = notifier.account;

/**
 * APIを呼ぶ層だけが使う（セッションを `Authorization` に付ける）。画面には渡さない。認証が要る呼び出しは、必ず、これの
 * `withSession` を通す（通さないと、セッションが失効したことが、画面へ伝わらない）。
 */
export const sessionAccess: SessionAccess = notifier.access;

/** 端末のセッションが無くなったときの通知を受ける（`ui/AuthStateProvider.tsx` が使う）。戻り値で解除する。 */
export const onSessionLost: (listener: () => void) => () => void = notifier.subscribe;
