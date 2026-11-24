// 招待の発行・取り消しに失敗したときの、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`InviteRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。`unauthorized`・`not-signed-in` は、
// 層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
// 読み込みの失敗は、ホームと同じ文言（`loadHomeErrorMessage`）。
import { AuthError } from '../repositories/authError.ts';
import { InviteRejectedError } from '../repositories/inviteRepository.ts';

export type InviteAction = 'issue' | 'revoke';

/**
 * 共有シートを開けなかったとき。招待は、発行の時点でできている（共有に失敗しても取り消されない）ので、一覧の「共有」からやり直せる
 * ことを伝える。
 */
export const SHARE_FAILED_MESSAGE =
  '共有を開けませんでした。招待は作られているので、下の一覧の「共有」から、もう一度お試しください。';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあとに、画面の内容を読み直すか。招待できるかの状態や、招待の一覧が、読んだときから変わったとき
 * （満員になった・脱退が確定した・すでに使われた・もう無い）は、読み直す。**未使用の招待が上限（`too_many_invites`）のときも
 * 読み直す**: 別の端末で発行した招待は、読み直すまで一覧に出ないので、「不要な招待を取り消して」と案内しても、取り消すものが画面に
 * 無いことがある。競合（`conflict`）は、読み直しても画面の状態は変わらない。**取り消しの失敗のあとは、もう無いなど一覧が古いことが
 * 多いので、断られたら読み直す**（競合を除く）。
 */
export function shouldReloadAfter(error: unknown, action: InviteAction): boolean {
  if (!(error instanceof InviteRejectedError)) return false;
  if (action === 'revoke') return error.reason !== 'conflict';
  return (
    error.reason === 'group_full' ||
    error.reason === 'forbidden' ||
    error.reason === 'not_found' ||
    error.reason === 'too_many_invites'
  );
}

/**
 * 送ったあと、サーバーで済んだか分からない失敗か（サーバーが断った場合は、済んでいない）。発行でこれに当たったときは、招待が
 * できているかもしれない（トークンはもう分からない）ので、画面は一覧を読み直す。
 */
export function resultUnknown(error: unknown): boolean {
  return !(error instanceof InviteRejectedError);
}

function commonMessage(error: unknown, failed: string): string | null {
  switch (codeOf(error)) {
    case 'network':
      return `${failed}通信できませんでした。電波のよいところで、もう一度お試しください。`;
    case 'unavailable':
      return `${failed}サーバーが混み合っています。しばらくしてから、もう一度お試しください。`;
    case 'unauthorized':
    case 'not-signed-in':
      return 'ログインを確認できませんでした。もう一度ログインしてください。';
    case 'storage-failed':
      return 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。';
    default:
      return null;
  }
}

/** 招待を発行できなかったとき。 */
export function issueInviteErrorMessage(error: unknown): string {
  const failed = '招待を作れませんでした。';
  const common = commonMessage(error, failed);
  if (common !== null) return common;
  if (error instanceof InviteRejectedError) {
    switch (error.reason) {
      case 'group_full':
        return `${failed}このグループは満員です。`;
      case 'too_many_invites':
        return `${failed}使っていない招待が多すぎます。不要な招待を取り消してから、もう一度お試しください。`;
      case 'forbidden':
        return `${failed}脱退が確定しているため、このグループには招待できません。`;
      case 'not_found':
        return `${failed}このグループを開けませんでした。グループの状態が変わったかもしれません。`;
      case 'conflict':
        return `${failed}他の操作と重なりました。もう一度お試しください。`;
      default:
        return `${failed}アプリを最新の版に更新して、お試しください。`;
    }
  }
  if (codeOf(error) === 'invalid-response') {
    // 発行の応答から、招待のIDとトークンを読めなかった。サーバーでは、招待ができているかもしれない（JSONでない200、
    // たとえば宿のWi-Fiの認証画面なら、できていない）。トークンは、この応答でしか分からない
    return `${failed}サーバーの応答を読み取れませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度お試しください。`;
  }
  return `${failed}時間をおいて、もう一度お試しください。`;
}

/** 招待を取り消せなかったとき。 */
export function revokeInviteErrorMessage(error: unknown): string {
  const failed = '招待を取り消せませんでした。';
  const common = commonMessage(error, failed);
  if (common !== null) return common;
  if (error instanceof InviteRejectedError) {
    switch (error.reason) {
      case 'invite_already_used':
        return `${failed}この招待は、すでに使われています。`;
      case 'not_found':
        // サーバーが404にするのは、自分がもうメンバーでない・グループが無い・自分が発行した招待でない、のいずれか。取り消し済みと
        // 期限切れは、404ではなく成功にする（`worker/src/invites.ts`）ので、その理由は書かない
        return `${failed}この招待を開けませんでした。グループの状態が変わったかもしれません。`;
      case 'conflict':
        return `${failed}他の操作と重なりました。もう一度お試しください。`;
      default:
        return `${failed}アプリを最新の版に更新して、お試しください。`;
    }
  }
  return `${failed}時間をおいて、もう一度お試しください。`;
}
