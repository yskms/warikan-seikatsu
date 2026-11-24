// カテゴリと負担割合の操作に失敗したときの、画面に出す文言。失敗の種類は `AuthError.code` と、断られたときの理由
// （`CategoryRejectedError.reason`）で区別する（`message` は英語のログ用で、画面には出さない）。`unauthorized`・
// `not-signed-in` は、層がセッションを捨てて、画面がログイン画面へ戻す（`ui/AuthStateProvider.tsx`）ので、ここの文言は、
// ほとんど見えない。読み込みの失敗は、ホームと同じ文言（`loadHomeErrorMessage`）。
//
// どの操作も、結果が分からない失敗（通信が切れた、応答が読めない）のあとで同じ操作をやり直しても、二重にはならない
// （割合の保存は置き換え、変更・並べ替えは同じ内容なら同じ結果、作成は同じ `id` を使い回す）。
import { AuthError } from '../repositories/authError.ts';
import { CategoryRejectedError } from '../repositories/categoryRepository.ts';
import { formatMonth } from './dateFormat.ts';

export type CategoryAction = 'save-share' | 'create' | 'update' | 'reorder';

const FAILED: Record<CategoryAction, string> = {
  'save-share': '割合を保存できませんでした。',
  create: 'カテゴリを追加できませんでした。',
  update: 'カテゴリを変更できませんでした。',
  reorder: '並べ替えを保存できませんでした。',
};

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあとに、画面の内容を読み直すか。他のメンバーの操作で古くなったとき（競合・メンバーや費目の増減・月が
 * 締まった）は読み直して、もう一度操作してもらう。入力の形・権限・範囲外などは、読み直しても同じなので読み直さない。
 */
export function shouldReloadAfter(error: unknown): boolean {
  if (!(error instanceof CategoryRejectedError)) return false;
  return (
    error.reason === 'conflict' ||
    error.reason === 'members_changed' ||
    error.reason === 'categories_changed' ||
    error.reason === 'month_closed'
  );
}

export function categoryErrorMessage(error: unknown, action: CategoryAction): string {
  if (error instanceof CategoryRejectedError) {
    switch (error.reason) {
      case 'conflict':
        return '他の操作と重なりました。画面を読み直しました。確認して、もう一度お試しください。';
      case 'month_closed':
        return 'この月は、すでに締められています。締めた月の割合は変えられません。';
      case 'month_not_editable':
        if (error.from !== null && error.to !== null) {
          return `この月の割合は変えられません。${formatMonth(error.from)}から${formatMonth(error.to)}までの間で選んでください。`;
        }
        return 'この月の割合は変えられません。';
      case 'members_changed':
        return 'メンバーが変わったため、保存できませんでした。画面を読み直しました。確認して、もう一度保存してください。';
      case 'categories_changed':
        return 'カテゴリが変わったため、並べ替えを保存できませんでした。画面を読み直しました。もう一度並べ替えてください。';
      case 'too_many_categories':
        return 'カテゴリは30個までです（使わなくしたカテゴリも数えます）。';
      case 'currency_mismatch':
        return 'グループの通貨が変わっています。画面を開き直してください。';
      case 'forbidden':
        return '脱退が確定しているため、変更できません。';
      case 'not_found':
        return 'グループまたはカテゴリを確認できませんでした。メンバーでなくなったか、グループが削除された可能性があります。';
      default:
        // 400 など。リクエストはアプリが組み立てるので、残るのは、アプリとサーバーの食い違い
        return `${FAILED[action]}アプリを最新の版に更新して、お試しください。`;
    }
  }
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
      return `${FAILED[action]}アプリを最新の版に更新して、お試しください。`;
    case 'invalid-response':
      // 応答が読めない。サーバーでは済んでいるかもしれない。同じ操作をやり直しても、二重にはならない
      return '結果を確認できませんでした。Wi-Fiの認証画面など、通信環境が原因のこともあります。もう一度操作しても、二重にはなりません。';
    default:
      return `${FAILED[action]}時間をおいて、もう一度お試しください。`;
  }
}
