// グループの読み込み・作成の失敗を、画面に出す文言にする。失敗の種類は `AuthError.code` で区別する（`message` は英語の
// ログ用で、画面には出さない）。`unauthorized`・`not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻る
// （`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
import { AuthError } from '../repositories/authError.ts';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/** グループの一覧を読めなかったとき。 */
export function loadGroupsErrorMessage(error: unknown): string {
  switch (codeOf(error)) {
    case 'network':
      return '通信できませんでした。電波のよいところで、もう一度お試しください。';
    case 'unavailable':
      return 'サーバーが混み合っています。しばらくしてから、もう一度お試しください。';
    case 'unauthorized':
    case 'not-signed-in':
      return 'ログインを確認できませんでした。もう一度ログインしてください。';
    case 'storage-failed':
      return 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。';
    default:
      return 'グループを読み込めませんでした。時間をおいて、もう一度お試しください。';
  }
}

/**
 * グループを作れなかったとき。通信の失敗（`network`）は、サーバーで作成が済んでいるかもしれない。同じ `id` でやり直せば
 * 2つにはならないので、「もう一度お試しください」でよい。
 */
export function createGroupErrorMessage(error: unknown): string {
  switch (codeOf(error)) {
    case 'network':
      return '通信できませんでした。電波のよいところで、もう一度お試しください。';
    case 'unavailable':
      return 'サーバーが混み合っています。しばらくしてから、もう一度お試しください。';
    case 'unauthorized':
    case 'not-signed-in':
      return 'ログインを確認できませんでした。もう一度ログインしてください。';
    case 'storage-failed':
      return 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。';
    default:
      return 'グループを作れませんでした。時間をおいて、もう一度お試しください。';
  }
}
