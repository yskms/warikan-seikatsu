// ホームのデータを読めなかったときの文言。失敗の種類は `AuthError.code` で区別する（`message` は英語のログ用で、画面には
// 出さない）。`unauthorized`・`not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す
// （`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
import { AuthError } from '../repositories/authError.ts';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

export function loadHomeErrorMessage(error: unknown): string {
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
    case 'invalid-request':
      // サーバーが受け付けなかった（400・403・404・409）。やり直しても直らない（グループを抜けた、月の範囲が変わった、
      // アプリとサーバーの食い違い）ので、時間をおく案内は、誤解のもと。
      return 'データを読み込めませんでした。グループの状態が変わったかもしれません。アプリを開き直しても直らないときは、最新の版に更新して、お試しください。';
    case 'invalid-response':
      // 応答が読めない。サーバーとアプリの食い違いのほかに、JSONでない200（宿のWi-Fiの認証画面など）もこれに当たる。
      return 'データを読み込めませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。直らないときは、アプリを最新の版に更新して、お試しください。';
    default:
      return 'データを読み込めませんでした。時間をおいて、もう一度お試しください。';
  }
}
