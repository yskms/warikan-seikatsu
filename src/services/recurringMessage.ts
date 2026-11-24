// 固定費の保存・止める・再開・削除に失敗したときの、画面に出す文言と、成功のあとの案内。失敗の種類は `AuthError.code` と、
// 断られたときの理由（`RecurringRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。入力内容は、
// どの失敗でも消さない（呼び出し側）。`unauthorized`・`not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す
// （`ui/AuthStateProvider.tsx`）ので、ここの文言は、ほとんど見えない。
import type { RecurringSaved, UpdateRecurringRequest } from '../domain/recurring.ts';
import { AuthError } from '../repositories/authError.ts';
import { RecurringRejectedError } from '../repositories/recurringRepository.ts';

export type RecurringWriteAction = 'create' | 'update' | 'pause' | 'resume' | 'remove';

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/** 保存しようとした入力のうち、`member_not_available` の原因を見分けるもの（支払う人か、負担の対象か）。 */
export interface RecurringSaveContext {
  payerMemberId?: string | null;
  /** 負担の指定（この固定費だけ負担を変える）に入れているメンバー。カテゴリの割合なら空 */
  splitMemberIds?: readonly string[];
}

/**
 * 失敗の文言。`memberName` は、`member_not_available` で、使えないメンバーの名前を引く（無ければ名前なしの文言）。
 * `member_not_available` は、支払う人にも負担の対象にも返る（`field` は無く、`memberId` だけ）ので、`context` で、どちらが
 * 原因かを見分けて、直す場所を案内する。通信の失敗は、サーバーで済んでいるかもしれない。登録は同じ `id` で、変更・止める・
 * 再開は同じ内容で、やり直しても二重にならない（削除は、2回目が「すでに無い」になるだけ）。
 */
export function saveRecurringErrorMessage(
  error: unknown,
  action: RecurringWriteAction,
  memberName: (memberId: string) => string | undefined = () => undefined,
  context: RecurringSaveContext = {},
): string {
  const verb = action === 'remove' ? '削除' : action === 'pause' ? '止める操作' : action === 'resume' ? '再開' : '保存';
  if (error instanceof RecurringRejectedError) {
    switch (error.reason) {
      case 'conflict':
        // 読み直して1回やり直しても、他のメンバーの書き込みと競合した（docs/backend-design.md 8章）
        return action === 'pause' || action === 'resume' || action === 'remove'
          ? '他のメンバーが更新しました。画面を閉じて、固定費の一覧で状態を確認してください。'
          : `他のメンバーが更新しました。もう一度${verb}してください。`;
      case 'member_not_available': {
        const memberId = error.memberId;
        const name = memberId === null ? undefined : memberName(memberId);
        const asPayer = memberId !== null && memberId === context.payerMemberId;
        const inSplit = memberId !== null && (context.splitMemberIds ?? []).includes(memberId);
        const who = name === undefined ? '使えないメンバー' : `${name}さん`;
        if (asPayer && inSplit) return `${who}は、支払う人にも負担の対象にもできません。支払う人と負担の分け方を変えてください。`;
        if (asPayer) return `${who}は、支払う人にできません。支払う人を選び直してください。`;
        return name === undefined
          ? '負担の対象に、使えないメンバーが含まれています。負担の分け方を変えてください。'
          : `${name}さんは負担の対象にできません。負担の分け方を変えてください。`;
      }
      case 'category_not_available':
        return 'このカテゴリは、使わない設定になっています。別のカテゴリを選ぶか、カテゴリを「また使う」に戻してください。';
      case 'currency_mismatch':
        return 'グループの通貨が変わりました。シートを閉じて、開き直してください。';
      case 'too_many_recurring_expenses':
        return '登録できる固定費の数の上限に達しました。使わない固定費を削除してから、もう一度お試しください（まだ一度も支出を作っていない固定費は、削除できます）。';
      case 'recurring_expense_in_use':
        return '支出をすでに作った固定費は、削除できません。「止める」か、終了する月を決めてください。';
      case 'not_found':
        return action === 'remove'
          ? 'この固定費は、すでに削除されています。シートを閉じて、一覧で確認してください。'
          : 'この固定費は、すでに削除されたか、見られない状態です。シートを閉じて、一覧で確認してください。';
      case 'forbidden':
        return 'このグループでは、固定費を登録・変更できません。';
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
      // 応答が読めない。サーバーでは済んでいるかもしれない。同じ内容でやり直しても、二重にはならない
      return `結果を確認できませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度${action === 'pause' ? '操作' : verb}しても、二重にはなりません。`;
    default:
      return `${verb}できませんでした。時間をおいて、もう一度お試しください。`;
  }
}

export interface RecurringNotice {
  title: string;
  body: string;
}

/**
 * 保存のあとに出す「今月の分は作られません」の案内。応答の `thisMonthSkipped` は「今月の分を作らない記録がいまある」という
 * 状態なので、止めて再開したときや、内容を直しただけのときも true が返る。案内は、**登録・再開・日や開始月を変えた操作のあと**に
 * 出し、内容を直しただけのときは出さない（docs/screens.md 6章の「固定費」）。
 */
export function skippedNotice(change: 'create' | UpdateRecurringRequest, saved: RecurringSaved): RecurringNotice | null {
  if (!saved.thisMonthSkipped) return null;
  const relevant =
    change === 'create' || change.paused === false || change.dayOfMonth !== undefined || change.startMonth !== undefined;
  return relevant ? { title: '今月の分は作られません', body: '必要なら、支出を直接登録してください。' } : null;
}
