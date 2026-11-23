// ログインに使う `V`・`C`・`SHA-256(T)` の生成。乱数とSHA-256の実体は、実行環境が持つ（アプリは expo-crypto。
// `platform/authCrypto.ts`）ので注入し、ここは、Workerが期待する形（43字のbase64url）に整えて、確かめるだけ。
// 方式は docs/backend-design.md 9章の「認証API」。サインインの層（`accountService`。`platform/accountService.ts` が組み立てる）が使う。
//
// - `T`：`POST /auth/nonce` が返す不透明な値（サーバーが作る。アプリは作らない）。
// - `V`：AndroidのAppleログイン（Web経由）の検証用の値。32バイトの乱数の base64url（43字）。アプリのメモリにだけ置く。
// - `C = SHA-256(V)` の base64url（43字）。`/auth/nonce` に `{ "kind": "web", "challenge": C }` で送る。
// - `SHA-256(T)` の base64url（43字）。AppleとGoogleのサインインの `nonce`（Webのフローでは `state` も）に渡す。
// どちらのハッシュも、**文字列（UTF-8）の** SHA-256 で、`V`・`T` を base64url にデコードした元のバイト列のハッシュではない
// （Workerの `nonceHash` と同じ）。
//
// 守ること:
// - 乱数は暗号論的に安全なもの（`Math.random` は使わない）。実体は、OSの乱数（expo-crypto の `getRandomBytes`）。
// - 値が想定の形でなければ、使わずに `AuthError('unexpected')`（アプリの不具合）で止める。形の違う `V`・`C` は、Workerが
//   400 で断るが、アプリの不具合と区別がつかなくなる前に、ここで止める。値そのものを、エラーの `message` にもログにも出さない。
import { AuthError } from '../repositories/authError.ts';
import { base64ToBase64Url, bytesToBase64Url } from './base64url.ts';

/** 実行環境が持つ、乱数とSHA-256。実機では expo-crypto（`platform/authCrypto.ts`）。 */
export interface CryptoPrimitives {
  /** 暗号論的に安全な乱数のバイト列（`length` バイト） */
  getRandomBytes(length: number): Uint8Array;
  /** 文字列（UTF-8）の SHA-256 のダイジェストを、base64（パディングあり）で返す */
  sha256Base64(text: string): Promise<string>;
}

/** `V` の元になる乱数のバイト数。base64url にすると43字（Workerの `isChallenge` と同じ長さ）。 */
export const VERIFIER_BYTES = 32;

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

export function createAuthCrypto(primitives: CryptoPrimitives) {
  return {
    /** 検証用の値 `V`（32バイトの乱数の base64url。43字）を作る。 */
    randomVerifier(): string {
      let bytes: Uint8Array;
      try {
        bytes = primitives.getRandomBytes(VERIFIER_BYTES);
      } catch {
        throw new AuthError('unexpected', 'Random bytes could not be generated');
      }
      if (bytes.length !== VERIFIER_BYTES) throw new AuthError('unexpected', 'Unexpected number of random bytes');
      return bytesToBase64Url(bytes);
    },

    /**
     * 文字列（UTF-8）の SHA-256 を base64url（パディングなし。43字）にする。`SHA-256(T)`（IDトークンの `nonce`）と、
     * `C = SHA-256(V)` に使う。
     */
    async sha256Base64Url(text: string): Promise<string> {
      let digest: string;
      try {
        digest = base64ToBase64Url(await primitives.sha256Base64(text));
      } catch {
        throw new AuthError('unexpected', 'The digest could not be computed');
      }
      if (!BASE64URL_43.test(digest)) throw new AuthError('unexpected', 'Unexpected digest');
      return digest;
    },
  };
}

export type AuthCrypto = ReturnType<typeof createAuthCrypto>;
