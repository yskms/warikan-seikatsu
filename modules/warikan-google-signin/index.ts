// Singfolio（modules/singfolio-google-signin）からのコピー（コピー元: singfolio 55aab9f）。Singfolio側を直したときは、差分を手で取り込む。
// このモジュール（ios・android・expo-module.config.json を含む）で変えたところは、名前（Singfolio → Warikan。
// Androidのパッケージ名は com.yskms.warikanseikatsu.googlesignin）だけ。
import { requireOptionalNativeModule } from 'expo';

type WarikanGoogleSignInNative = {
  signIn(nonce: string): Promise<string>;
};

// ネイティブ側が無くても（このモジュールを含まない古い開発ビルドなど）、import で落とさない。
// `requireNativeModule` は、無いと import の時点で投げ、アプリの起動ごと止めてしまう。ログインは
// 要求しない機能なので、v1.0の機能を巻き込まない（`signInWithGoogle` を呼んだときに失敗にする）。
const native = requireOptionalNativeModule<WarikanGoogleSignInNative>('WarikanGoogleSignIn');

/**
 * Google の ID トークンを1回取り出す。`nonce` はトークンの nonce クレームに入る。
 * 失敗は、`code` が ERR_CANCELED / ERR_NO_ACCOUNT / ERR_NOT_CONFIGURED / ERR_NO_PRESENTER /
 * ERR_NO_ID_TOKEN / ERR_FAILED（ネイティブ側）か、ERR_UNAVAILABLE（ネイティブ側が組み込まれていない）の
 * いずれかの例外になる。トークンはログに出さない。
 */
export function signInWithGoogle(nonce: string): Promise<string> {
  if (native === null) {
    return Promise.reject(
      Object.assign(new Error('The WarikanGoogleSignIn native module is not available'), {
        code: 'ERR_UNAVAILABLE',
      }),
    );
  }
  return native.signIn(nonce);
}
