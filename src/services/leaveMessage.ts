// 脱退を選ぶ・取り消すに失敗したとき、成功したあとの案内の、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`GroupRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。`unauthorized`・`not-signed-in` は、
// 層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
// 読み込みの失敗は、ホームと同じ文言（`loadHomeErrorMessage`）。
import { AuthError } from '../repositories/authError.ts';
import { GroupRejectedError, type LeaveRequested } from '../repositories/groupRepository.ts';

export type LeaveAction = 'request' | 'cancel';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあと、画面の内容を読み直すか。脱退の状態（すでに選んでいる・すでに確定した・選んでいない・もう無い）が、
 * 読んだときから変わったときは、読み直す。競合（`conflict`）は、読み直しても画面の状態は変わらない。
 */
export function shouldReloadAfterLeave(error: unknown): boolean {
  return error instanceof GroupRejectedError && error.reason !== 'conflict';
}

/**
 * 送ったあと、サーバーで済んだか分からない失敗か（サーバーが断った場合は、済んでいない）。通信が切れた・応答が読めない、のあとは、
 * 脱退を選べているかもしれないので、画面は読み直す。
 */
export function leaveResultUnknown(error: unknown): boolean {
  return !(error instanceof GroupRejectedError);
}

/** 脱退を選べなかった・取り消せなかったときの、画面の文言。 */
export function leaveErrorMessage(error: unknown, action: LeaveAction): string {
  const failed = action === 'request' ? '脱退を選べませんでした。' : '脱退を取り消せませんでした。';
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
  }
  if (error instanceof GroupRejectedError) {
    switch (error.reason) {
      case 'leave_already_requested':
        return `${failed}すでに脱退を選んでいます。`;
      case 'leave_confirmed':
        return `${failed}すでに脱退が確定しています。`;
      case 'not_leaving':
        return `${failed}脱退は選んでいません。`;
      case 'not_found':
        return `${failed}このグループを開けませんでした。グループの状態が変わったかもしれません。`;
      case 'conflict':
        return `${failed}他の操作と重なりました。もう一度お試しください。`;
      default:
        return `${failed}アプリを最新の版に更新して、お試しください。`;
    }
  }
  if (codeOf(error) === 'invalid-response') {
    // 応答が読めない（JSONでない200、たとえば宿のWi-Fiの認証画面）。サーバーでは、済んでいないかもしれない
    return `${failed}サーバーの応答を読み取れませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度お試しください。`;
  }
  return `${failed}時間をおいて、もう一度お試しください。`;
}

/** 脱退を選んだ結果。`requested` は、確定するまで取り消せる状態。 */
export type LeaveOutcome = 'requested' | 'confirmed' | 'group-deleted';

export function leaveOutcome(result: LeaveRequested): LeaveOutcome {
  if (result.groupDeleted) return 'group-deleted';
  return result.confirmed ? 'confirmed' : 'requested';
}

export interface LeaveDone {
  title: string;
  message: string;
}

/**
 * 脱退がその場で確定した（`confirmed`）・グループが消えた（`group-deleted`）ときに出す案内。確定するまで取り消せる状態
 * （`requested`）は、画面の表示が変わる（「脱退予定」と「脱退を取り消す」）ので、案内を出さない（`null`）。
 */
export function leaveDone(outcome: LeaveOutcome): LeaveDone | null {
  switch (outcome) {
    case 'requested':
      return null;
    case 'confirmed':
      return {
        title: '脱退しました',
        message: '脱退が確定しました。精算が残っているときは、そのあいだ、このグループの記録を見られます。',
      };
    case 'group-deleted':
      return {
        title: 'グループを削除しました',
        message: '最後のメンバーが脱退したため、グループのデータをすべて削除しました。元に戻すことはできません。',
      };
  }
}
