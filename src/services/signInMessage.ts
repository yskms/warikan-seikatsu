// ログイン（`accountService.signIn`）の失敗を、画面に出す文言にする。失敗の種類は `AuthError.code` で区別する
// （`message` は英語のログ用）。トークン・応答の内容は、`AuthError` にも文言にも載らない。
import type { AuthProvider } from '../domain/types.ts';
import { AuthError } from '../repositories/authError.ts';

const PROVIDER_NAMES: Record<AuthProvider, string> = { apple: 'Apple', google: 'Google' };

export function providerName(provider: AuthProvider): string {
  return PROVIDER_NAMES[provider];
}

/**
 * 画面に出す文言。出さないとき（利用者が取りやめた）と、失敗ではないとき（すでにサインイン済み）は `null`。
 * `already-signed-in` は、画面がログイン済みとして扱い直す（呼び出し側が、`isAlreadySignedIn` で見分ける）。
 */
export function signInErrorMessage(error: unknown, provider: AuthProvider): string | null {
  const code = error instanceof AuthError ? error.code : 'unexpected';
  const name = PROVIDER_NAMES[provider];
  switch (code) {
    case 'cancelled':
    case 'already-signed-in':
      return null;
    case 'network':
      return '通信できませんでした。電波のよいところで、もう一度お試しください。';
    case 'unavailable':
      return 'サーバーが混み合っています。しばらくしてから、もう一度お試しください。';
    case 'timeout':
      return 'ログインが時間内に終わりませんでした。もう一度お試しください。';
    case 'unauthorized':
      return 'ログインを確認できませんでした。もう一度お試しください。';
    case 'provider-failed':
      return `${name}でログインできませんでした。端末で${name}のアカウントにサインインしているかを確認して、もう一度お試しください。`;
    case 'provider-unavailable':
      return `この端末では、${name}でのログインをまだ使えません。`;
    case 'storage-failed':
      return 'ログインの情報を、この端末に保存できませんでした。端末のロックを解除して、もう一度お試しください。';
    default:
      return 'ログインできませんでした。時間をおいて、もう一度お試しください。';
  }
}

/** すでにサインインしている（別の経路で、先にログインが済んでいた）。画面は、ログイン済みとして扱い直す。 */
export function isAlreadySignedIn(error: unknown): boolean {
  return error instanceof AuthError && error.code === 'already-signed-in';
}
