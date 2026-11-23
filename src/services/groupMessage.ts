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
    case 'invalid-request':
      // サーバーとアプリの食い違い（やり直しても直らない）。時間をおく案内は、誤解のもと。
      return 'グループを読み込めませんでした。アプリを最新の版に更新して、お試しください。';
    case 'invalid-response':
      // 応答が読めない。サーバーとアプリの食い違いのほかに、JSONでない200（宿のWi-Fiの認証画面、プロキシが返すHTMLなど）も
      // これに当たる（`apiClient.ts`）。後者は、環境を変えれば直る。
      return 'グループを読み込めませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。直らないときは、アプリを最新の版に更新して、お試しください。';
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
    case 'invalid-request':
      // サーバーが入力を受け付けなかった（400・403・409）。入力は画面で検査済みなので、残るのは、端末のタイムゾーン名を
      // サーバーが知らない場合や、アプリとサーバーの食い違い。やり直しても直らないので、時間をおく案内はしない。
      // 409 は、他人のグループと `id` が衝突したときだけ（同じ利用者の再送・同時送信は、200で保存済みのグループが返る。
      // `worker/src/groups.ts`）。UUIDなので、まず起きない。
      return 'グループを作れませんでした。端末の日付と時刻の設定を確認し、アプリを最新の版に更新して、お試しください。';
    case 'invalid-response':
      // 作成の応答から、グループの `id` を読めなかった。サーバーでは、作成が済んでいるかもしれない（JSONでない200、
      // たとえば宿のWi-Fiの認証画面なら、作られていない）。どちらでも、開き直せば、作られていれば先へ進み、無ければ作成の画面に戻る。
      return 'サーバーの応答を読み取れませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。グループは作られている場合があるので、アプリを開き直して、確認してください。';
    default:
      return 'グループを作れませんでした。時間をおいて、もう一度お試しください。';
  }
}
