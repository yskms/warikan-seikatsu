// アカウントの削除（`accountService.deleteAccount`）の失敗と完了を、画面に出す文言にする（docs/screens.md 6章の「アカウントを削除」）。
// 失敗の種類は `AuthError.code` で区別する（`message` は英語のログ用）。トークン・応答の内容は、文言に載せない。
//
// **「削除されていない」と言い切れるのは、サーバーへ削除の要求を送る前の失敗だけ**（再認証が通らない、通信が要求の前に切れた、
// サーバーが混み合っている、など。`accountService.ts` の `deleteAccount`。500・503・429も、何も消えていない）。要求を送ったあとの
// 通信の失敗と読めない応答（`delete-unconfirmed`）は、削除が済んでいるかもしれない。想定外の失敗は、どちらとも言わない。
import { AuthError } from '../repositories/authError.ts';
import type { DeleteAccountResult } from './accountService.ts';

export interface DeleteFailure {
  /** 画面に出す文言。出さないとき（利用者が再認証を取りやめた）は `null` */
  message: string | null;
  /**
   * サーバーがこのセッションを認めなかった・サインインしていなかった（`unauthorized`・`not-signed-in`）。端末のセッションは
   * 捨てられ、ルートがログイン画面へ切り替える（`src/services/sessionLost.ts`）ので、この画面は外れる。文言は、ログイン画面に出す。
   */
  signedOut: boolean;
}

export function deleteAccountFailure(error: unknown): DeleteFailure {
  const code = error instanceof AuthError ? error.code : 'unexpected';
  switch (code) {
    case 'cancelled':
      return { message: null, signedOut: false };
    case 'network':
      return { message: '通信できませんでした。アカウントは削除されていません。電波のよいところで、もう一度お試しください。', signedOut: false };
    case 'unavailable':
      return { message: 'サーバーが混み合っています。アカウントは削除されていません。しばらくしてから、もう一度お試しください。', signedOut: false };
    case 'delete-unconfirmed':
      return {
        message:
          'サーバーと通信できず、アカウントが削除されたかどうか分かりません。もう一度お試しください。ログイン画面に戻ったときは、すでに削除されている可能性があります。',
        signedOut: false,
      };
    case 'unauthorized':
      return {
        message:
          'ログインが切れました。アカウントはすでに削除されている可能性があります。残っているときは、ログインし直して、もう一度削除してください。',
        signedOut: true,
      };
    case 'not-signed-in':
      return { message: 'ログインが切れました。アカウントは削除されていません。ログインし直してください。', signedOut: true };
    case 'reauth-failed':
    case 'provider-failed':
    case 'timeout':
      return { message: '本人確認ができなかったため、アカウントは削除されていません。もう一度お試しください。', signedOut: false };
    case 'account-mismatch':
      return {
        message: 'ログイン中のアカウントと違うため、アカウントは削除されていません。同じアカウントで、もう一度お試しください。',
        signedOut: false,
      };
    case 'provider-unavailable':
      return { message: 'この端末では、ログインに使った方法での本人確認を使えません。アカウントは削除されていません。', signedOut: false };
    case 'storage-failed':
      // 端末のログイン情報を読めなかった（端末のロック中かもしれない）。要求は送っていない
      return {
        message:
          'ログインの情報を、この端末から読み取れませんでした。アカウントは削除されていません。もう一度お試しください。続くときは、端末を再起動してみてください。',
        signedOut: false,
      };
    default:
      return { message: 'アカウントの削除を完了できませんでした。時間をおいて、もう一度お試しください。', signedOut: false };
  }
}

/**
 * 削除が済んだあとの案内。1行ずつ返す。
 * - 端末のログイン情報を消せなかった（`sessionCleared: false`）ときは、ログアウトを案内する。
 * - Appleの連携を解除できなかった（`appleRevoked: false`）ときは、Appleの設定からの解除を案内する（アカウントは消えている）。
 *   Googleは失効するものが無い（`null`）ので、何も足さない。
 */
export function deletedNotice(result: DeleteAccountResult): string[] {
  const lines = ['アカウントを削除しました。'];
  if (!result.sessionCleared) {
    lines.push('この端末には、ログインの情報が残っています。「ログアウト」を押して、完了してください。');
  }
  if (result.appleRevoked === false) {
    lines.push(
      'Appleでサインインの連携も解除するには、端末の設定で Apple Account の「Appleでサインイン」を開き、このアプリの使用を停止してください。',
    );
  }
  return lines;
}
