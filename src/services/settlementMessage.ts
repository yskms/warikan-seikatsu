// 月締め・精算完了・繰越に失敗したときの、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`SettlementRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。`unauthorized`・
// `not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、ここの文言は、
// ほとんど見えない。
//
// どの操作も、結果が分からない失敗（通信が切れた、応答が読めない）のあとで同じ操作をやり直しても、二重にはならない
// （済んでいれば 409 `month_closed`・`transfer_not_pending` で断られるだけ）。そのため、文言は「ホームで確認」と「もう一度」を案内する。
import { AuthError } from '../repositories/authError.ts';
import { SettlementRejectedError } from '../repositories/settlementRepository.ts';
import { formatMonthShort } from './dateFormat.ts';

export type SettlementAction = 'close' | 'settle' | 'carry';

/** 最後の1人の脱退で、締めずにグループごと消したとき（`CloseResult` の `group-deleted`）の案内。 */
export const GROUP_DELETED_MESSAGE =
  '最後の1人が脱退したため、グループのデータをすべて削除しました。元に戻すことはできません。';

/**
 * 締めが断られたあと、確認の内容を読み直そうとして、読み直しも失敗したとき（読み込みの失敗の表示）の文言。断られた理由
 * （「先に10月分の精算を済ませてください」など、次にやることが分かる情報）を捨てず、読み込みの失敗の文言と並べる。
 */
export function withReloadFailure(rejectionMessage: string, loadMessage: string): string {
  return `${rejectionMessage}\n\n${loadMessage}`;
}

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあとは、画面の内容が古い（他のメンバーが先に締めた・処理した、など）ので、読み直す。通信の失敗などは、
 * 読み直しても同じ失敗になりうる（読み直しの失敗が、操作の失敗の文言を隠さないよう、読み直さない）。
 */
export function shouldReloadAfter(error: unknown): boolean {
  return error instanceof SettlementRejectedError;
}

function previousMonthLabel(month: string | null): string {
  return month === null ? '前の月' : formatMonthShort(month);
}

const FAILED: Record<SettlementAction, string> = {
  close: '締められませんでした。',
  settle: '精算済みにできませんでした。',
  carry: '繰り越せませんでした。',
};

/** 結果が分からないとき、何で確かめるか（操作ごと） */
const CONFIRM_IN_HOME: Record<SettlementAction, string> = {
  close: '締められたかは、ホームで確認してください。',
  settle: '処理されたかは、ホームで確認してください。',
  carry: '処理されたかは、ホームで確認してください。',
};

export function settlementErrorMessage(error: unknown, action: SettlementAction): string {
  if (error instanceof SettlementRejectedError) {
    switch (error.reason) {
      case 'conflict':
        // 読み直して1回やり直す、ということはしない（確認した内容が変わりうるため。docs/backend-design.md 9章）。
        // 原因は、他のメンバーの操作とは限らない（脱退月が飛ばされた月の締めは、先に脱退を確定させて409にする。
        // 最後の1人なら、グループごと消える）ので、誰かが操作したとは言わない。読み直せたか（締めのシートは読み直す。精算・
        // 繰越は、ホームが読み直すが、失敗しても投げない）も、この文言では言わない。
        return action === 'close'
          ? '内容が変わりました。確認してから、もう一度締めてください。'
          : '内容が変わりました。画面を確認して、もう一度お試しください。';
      case 'month_closed':
        return 'この月は、すでに締められています。';
      case 'month_skipped':
        return 'この月は、締めずに次の月へ進んだため、締められません。';
      case 'month_not_started':
        return 'この月は、まだ始まっていません。';
      case 'previous_month_not_closed':
        return `先に${previousMonthLabel(error.month)}を締めてください。`;
      case 'previous_month_unsettled':
        return `先に${previousMonthLabel(error.month)}分の精算を済ませてください。`;
      case 'transfer_not_pending':
        if (error.transferStatus === 'settled') return 'この送金は、すでに精算済みです。';
        if (error.transferStatus === 'carried') return 'この送金は、すでに繰り越されています。';
        return 'この送金は、すでに処理されています。';
      case 'transfer_not_carryable':
        return 'この送金は、脱退するメンバーや削除されたユーザーが関わるため、繰り越せません。精算済みにしてください。';
      case 'not_found':
        return action === 'close'
          ? 'このグループを確認できませんでした。メンバーでなくなったか、グループが削除された可能性があります。'
          : 'この送金を確認できませんでした。グループの状態が変わったかもしれません。';
      case 'forbidden':
        return 'この月は、あなたが締められる月ではありません。';
      default:
        // 400 など。リクエストはアプリが組み立てるので、残るのは、アプリとサーバーの食い違い
        return `${FAILED[action]}アプリを最新の版に更新して、お試しください。`;
    }
  }
  switch (codeOf(error)) {
    case 'network':
      return `通信できませんでした。電波のよいところで、もう一度お試しください。${CONFIRM_IN_HOME[action]}`;
    case 'unavailable':
      return `サーバーが混み合っています。しばらくしてから、もう一度お試しください。${CONFIRM_IN_HOME[action]}`;
    case 'unauthorized':
    case 'not-signed-in':
      return 'ログインを確認できませんでした。もう一度ログインしてください。';
    case 'storage-failed':
      return 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。';
    case 'invalid-request':
      return `${FAILED[action]}アプリを最新の版に更新して、お試しください。`;
    case 'invalid-response':
      // 応答が読めない。サーバーでは済んでいるかもしれない。同じ操作をやり直しても、二重にはならない
      return `結果を確認できませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。${CONFIRM_IN_HOME[action]}もう一度操作しても、二重にはなりません。`;
    default:
      return `${FAILED[action]}時間をおいて、もう一度お試しください。`;
  }
}
