// 支出の保存・削除に失敗したときの、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`ExpenseRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。入力内容は、どの失敗でも消さない
// （呼び出し側）。`unauthorized`・`not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す
// （`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
import { AuthError } from '../repositories/authError.ts';
import { ExpenseRejectedError } from '../repositories/expenseRepository.ts';

export type ExpenseWriteAction = 'create' | 'update' | 'remove';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * 保存・削除できなかったとき。`memberName` は、`member_not_available` で、使えないメンバーの名前を引く（無ければ名前なしの文言）。
 * 通信の失敗は、サーバーで済んでいるかもしれない。登録は同じ `id` で、編集は同じ内容で、削除は2回目が404になるだけなので、
 * どれも「もう一度」でよい。
 */
export function saveExpenseErrorMessage(
  error: unknown,
  action: ExpenseWriteAction,
  memberName: (memberId: string) => string | undefined = () => undefined,
): string {
  const verb = action === 'remove' ? '削除' : '保存';
  if (error instanceof ExpenseRejectedError) {
    switch (error.reason) {
      case 'conflict':
        // 読み直して1回やり直しても、他のメンバーの書き込みと競合した（docs/backend-design.md 8章）
        return `他のメンバーが更新しました。もう一度${verb}してください。`;
      case 'month_closed':
        return 'この月は締められたため、変更できません。シートを閉じて、ホームで確認してください。';
      case 'month_not_registerable':
        return 'この月には登録できなくなりました。登録する月を選び直してください。';
      case 'member_not_available': {
        const name = error.memberId === null ? undefined : memberName(error.memberId);
        return name === undefined
          ? 'この月の支出に使えないメンバーが含まれています。負担の分け方を変えてください。'
          : `${name}さんは負担の対象にできません。負担の分け方を変えてください。`;
      }
      case 'category_not_available':
        return 'この費目は使えなくなりました。別の費目を選んでください。';
      case 'currency_mismatch':
        return 'グループの通貨が変わりました。シートを閉じて、開き直してください。';
      case 'not_found':
        return action === 'remove'
          ? 'この支出は、すでに削除されています。シートを閉じて、ホームで確認してください。'
          : 'この支出は、すでに削除されたか、見られない状態です。シートを閉じて、ホームで確認してください。';
      case 'forbidden':
        return 'このグループでは、支出を登録・変更できません。';
      default:
        // 400（形の違う入力）など。入力は画面で検査済みなので、残るのは、アプリとサーバーの食い違い
        return `${verb}できませんでした。アプリを最新の版に更新して、お試しください。`;
    }
  }
  switch (codeOf(error)) {
    case 'network':
      return '通信できませんでした。入力内容はそのままです。電波のよいところで、もう一度お試しください。';
    case 'unavailable':
      return 'サーバーが混み合っています。入力内容はそのままです。しばらくしてから、もう一度お試しください。';
    case 'unauthorized':
    case 'not-signed-in':
      return 'ログインを確認できませんでした。もう一度ログインしてください。';
    case 'storage-failed':
      return 'この端末に保存したログイン情報を読み取れませんでした。端末のロックを解除して、もう一度お試しください。';
    case 'invalid-request':
      return `${verb}できませんでした。アプリを最新の版に更新して、お試しください。`;
    case 'invalid-response':
      // 応答が読めない。サーバーでは済んでいるかもしれない。同じ内容でやり直しても、二重にはならない（登録は同じ `id`、
      // 編集は同じ内容、削除は2回目が「すでに無い」になるだけ）
      return `結果を確認できませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度${verb}しても、二重にはなりません。`;
    default:
      return `${verb}できませんでした。時間をおいて、もう一度お試しください。`;
  }
}
