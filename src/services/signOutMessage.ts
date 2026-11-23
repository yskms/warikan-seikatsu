// ログアウト（`accountService.signOut`）の失敗を、画面に出す文言にする。失敗するのは、端末の値を消せなかったとき
// （`storage-failed`。やり直せる）だけ。サーバー側の失効まで確認できなかったことは、失敗にしない（`SignOutResult`）。
import { AuthError } from '../repositories/authError.ts';

export function signOutErrorMessage(error: unknown): string {
  return error instanceof AuthError && error.code === 'storage-failed'
    ? 'ログアウトの情報を、この端末から消せませんでした。もう一度お試しください。続くときは、端末を再起動してみてください。'
    : 'ログアウトできませんでした。もう一度お試しください。';
}
