// グループの設定を保存できなかったときの、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`GroupRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。`unauthorized`・`not-signed-in` は、
// 層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
// 読み込みの失敗は、ホームと同じ文言（`loadHomeErrorMessage`）。
import { AuthError } from '../repositories/authError.ts';
import { GroupRejectedError } from '../repositories/groupRepository.ts';
import type { SaveStep } from './groupSettingsSave.ts';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあと、画面の内容を読み直して、入力を載せ直すか（`rebase`）。変えられるものが変わったと分かる断り
 * （脱退が確定した・通貨が固定された）のときだけ。競合（`conflict`）は、書き込みが重なっただけで、内容は変わっていないので、
 * 読み直さず、もう一度押してもらう（同じ内容の送り直しは、結果が変わらない）。
 */
export function shouldReloadAfterSave(error: unknown): boolean {
  return error instanceof GroupRejectedError && (error.reason === 'forbidden' || error.reason === 'currency_locked');
}

/**
 * 断られた理由が、グループ（自分の所属）が無いことか（404 `not_found`: グループが消えた・自分が脱退済みになった、など）。このとき、
 * 画面は、所属グループの一覧を読み直す（`reloadGroups`）。この画面から先へは、進めない。
 */
export function saveLostGroup(error: unknown): boolean {
  return error instanceof GroupRejectedError && error.reason === 'not_found';
}

/** 保存できなかったことの頭の文。済んだ段階があれば、それが保存できたことを先に伝える。 */
function failedHead(step: SaveStep, saved: boolean): string {
  if (step === 'group') return 'グループ名・通貨を保存できませんでした。';
  return saved
    ? 'グループ名・通貨は保存しました。自分の表示名・色を保存できませんでした。'
    : '自分の表示名・色を保存できませんでした。';
}

/** 保存できなかったときの文言。`step` は失敗した段階、`saved` は、その前に済んだ段階があるか（`SaveResult`）。 */
export function saveErrorMessage(error: unknown, step: SaveStep, saved: boolean): string {
  const failed = failedHead(step, saved);
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
      case 'forbidden':
        return `${failed}脱退が確定した人は、グループ名と通貨を変えられません。`;
      case 'currency_locked':
        return `${failed}支出・固定費・上限額つきの負担・締めた月のどれかがあるあいだは、通貨を変えられません。`;
      case 'not_found':
        return `${failed}このグループを開けませんでした。グループの状態が変わったかもしれません。`;
      case 'conflict':
        return `${failed}他の操作と重なりました。もう一度お試しください。`;
      default:
        // 400（入力は画面で検査済みなので、アプリとサーバーの食い違い）。やり直しても直らないので、時間をおく案内はしない
        return `${failed}アプリを最新の版に更新して、お試しください。`;
    }
  }
  if (codeOf(error) === 'invalid-response') {
    // 応答が読めない（JSONでない200、たとえば宿のWi-Fiの認証画面）。サーバーでは、済んでいないかもしれない
    return `${failed}サーバーの応答を読み取れませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度お試しください。`;
  }
  return `${failed}時間をおいて、もう一度お試しください。`;
}

/**
 * 破棄の確認の本文。保存の途中で、一部だけ済んでいる（`saved`）ときは、それを伝える（破棄しても、済んだ分は戻らない）。
 */
export function discardNote(saved: boolean): string {
  return saved
    ? 'グループ名・通貨は、すでに保存されています。入力した、ほかの変更は保存されません。'
    : '入力した内容は保存されません。';
}
