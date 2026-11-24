// 招待を開いて参加する側（参加確認の画面。docs/screens.md 2章）の、失敗の分類と画面に出す文言。失敗の種類は `AuthError.code` と、
// 断られたときの理由（`InviteRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。
// `unauthorized`・`not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、
// ここの文言は、ほとんど見えない。
//
// 参加（POST）は、結果が分からない失敗のあとに**送り直してよい**: すでに参加していれば、サーバーは使用済みの招待でも
// 409 `already_member`（`groupId` つき）を返す。これを成功として扱い、そのグループを開く（`already-member`）。そのため、
// 結果が分からない失敗の文言は、「参加できている場合があります。もう一度押してください」と案内する。
import { AuthError } from '../repositories/authError.ts';
import { InviteRejectedError } from '../repositories/inviteRepository.ts';

export const INVITE_UNAVAILABLE_MESSAGE = 'この招待URLは使えません。招待した人に、新しいURLを送ってもらってください。';

/**
 * 満員の案内。人数の上限（5人）は、サーバーが決める値（`worker/src/limits.ts`）で、**表示にだけ**書く。満員かどうかは、招待内容の
 * 確認の `groupFull` と、参加の409 `group_full` で決める（アプリで人数を数えない）。
 */
export const GROUP_FULL_MESSAGE = 'このグループは満員です（5人まで）。';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/** 使えない招待か（404。知らないトークン・期限切れ・使用済み・取り消し済み・発行者が抜けた、を区別しない）。 */
function isUnavailable(error: unknown): boolean {
  return error instanceof InviteRejectedError && error.status === 404;
}

/** 招待内容の確認（`preview`）の失敗。`unavailable` はやり直しても同じ。`retry` は、時間をおけば通りうる。 */
export type PreviewFailure = { kind: 'unavailable' } | { kind: 'retry'; message: string };

export function classifyPreviewFailure(error: unknown): PreviewFailure {
  if (isUnavailable(error)) return { kind: 'unavailable' };
  const failed = '招待の内容を確認できませんでした。';
  switch (codeOf(error)) {
    case 'network':
      return { kind: 'retry', message: `${failed}通信できませんでした。電波のよいところで、もう一度お試しください。` };
    case 'unavailable':
      return { kind: 'retry', message: `${failed}サーバーが混み合っています。しばらくしてから、もう一度お試しください。` };
    case 'unauthorized':
    case 'not-signed-in':
      return { kind: 'retry', message: 'ログインを確認できませんでした。もう一度ログインしてください。' };
    case 'storage-failed':
      return {
        kind: 'retry',
        message: 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。',
      };
    case 'invalid-response':
      // サーバーとアプリの食い違いのほかに、JSONでない200（宿のWi-Fiの認証画面など）もこれに当たる（`apiClient.ts`）
      return {
        kind: 'retry',
        message: `${failed}Wi-Fiの認証画面など、通信環境が原因のこともあります。直らないときは、アプリを最新の版に更新して、お試しください。`,
      };
    case 'invalid-request':
      // サーバーが断った（404以外）。やり直しても直らない、アプリとサーバーの食い違い
      return { kind: 'retry', message: `${failed}アプリを最新の版に更新して、お試しください。` };
    default:
      return { kind: 'retry', message: `${failed}時間をおいて、もう一度お試しください。` };
  }
}

/**
 * 参加（`join`）の失敗。
 * - `unavailable`: 使えない招待（確認のあとに、期限切れ・使われた・取り消された）。やり直しても同じ。
 * - `full`: 満員（確認のあとに、ほかの招待で埋まった）。
 * - `already-member`: すでに参加している（結果が分からない失敗のあとの送り直しなど）。成功として、`groupId` のグループを開く
 *   （サーバーが返さなかった・読めなかったときは `null`）。
 * - `failed`: 参加できなかった、または、参加できたか分からない。`message` を出して、もう一度押してもらう。
 */
export type JoinFailure =
  | { kind: 'unavailable' }
  | { kind: 'full' }
  | { kind: 'already-member'; groupId: string | null }
  | { kind: 'failed'; message: string };

// 参加の失敗のあとの案内。済んでいるかもしれないので、もう一度押せば、済んでいれば先へ進める（`already-member`）ことを伝える
const MAYBE_JOINED = '参加できている場合があります。';
const PRESS_AGAIN = 'もう一度「参加する」を押してください。';

export function classifyJoinFailure(error: unknown): JoinFailure {
  if (isUnavailable(error)) return { kind: 'unavailable' };
  if (error instanceof InviteRejectedError) {
    switch (error.reason) {
      case 'group_full':
        return { kind: 'full' };
      case 'already_member':
        return { kind: 'already-member', groupId: error.groupId };
      case 'conflict':
        // 同時に参加しようとした人と重なった。サーバーでは、片方だけが参加する
        return { kind: 'failed', message: `他の操作と重なりました。${PRESS_AGAIN}` };
      default:
        // 400・403 など。入力は画面で検査済みなので、残るのは、アプリとサーバーの食い違い。やり直しても直らない
        return { kind: 'failed', message: '参加できませんでした。アプリを最新の版に更新して、お試しください。' };
    }
  }
  switch (codeOf(error)) {
    case 'network':
      return { kind: 'failed', message: `通信できませんでした。${MAYBE_JOINED}電波のよいところで、${PRESS_AGAIN}` };
    case 'unavailable':
      return { kind: 'failed', message: `サーバーが混み合っています。${MAYBE_JOINED}しばらくしてから、${PRESS_AGAIN}` };
    case 'unauthorized':
    case 'not-signed-in':
      return { kind: 'failed', message: 'ログインを確認できませんでした。もう一度ログインしてください。' };
    case 'storage-failed':
      return {
        kind: 'failed',
        message: 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。',
      };
    case 'invalid-response':
      // 参加の応答から `groupId` を読めなかった。サーバーでは、参加が済んでいるかもしれない（JSONでない200、たとえば
      // 宿のWi-Fiの認証画面なら、済んでいない）。送り直せば、済んでいれば `already-member` になる
      return {
        kind: 'failed',
        message: `サーバーの応答を読み取れませんでした。${MAYBE_JOINED}${PRESS_AGAIN}Wi-Fiの認証画面など、通信環境が原因のこともあります。`,
      };
    default:
      return { kind: 'failed', message: `参加できませんでした。${MAYBE_JOINED}時間をおいて、${PRESS_AGAIN}` };
  }
}
