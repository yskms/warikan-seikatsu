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

/**
 * `create-update` は、追加で、作成は済んだあとの、入力の反映（`PATCH`）。結果が分からない失敗のあとに送り直したとき、サーバーは
 * 保存済みの費目をそのまま返すので、直した内容をあとから送る（`CategoryEditSheet.tsx`）。作成と失敗の扱いを分ける（作成は
 * 済んでいるので、新しい `id` にしてはいけない）。
 */
export type CategoryAction = 'save-share' | 'acknowledge-reset' | 'create' | 'create-update' | 'update' | 'reorder';

const FAILED: Record<CategoryAction, string> = {
  'save-share': '割合を保存できませんでした。',
  'acknowledge-reset': 'お知らせを閉じられませんでした。',
  create: 'カテゴリを追加できませんでした。',
  'create-update': 'カテゴリは追加できましたが、入力した内容を反映できませんでした。',
  update: 'カテゴリを変更できませんでした。',
  reorder: '並べ替えを保存できませんでした。',
};

function codeOf(error: unknown): string {
  return error instanceof AuthError ? error.code : 'unexpected';
}

/**
 * サーバーが断ったあとに、画面の内容を読み直すか。他のメンバーの操作で古くなったとき（競合・メンバーや費目の増減・月が
 * 締まった）は読み直して、もう一度操作してもらう。入力の形・権限・範囲外などは、読み直しても同じなので読み直さない。
 * **追加（`create`・`create-update`）は読み直さない**: 追加の入力（名前・アイコン・色）に、サーバーの内容に合わせて作り直すものが
 * 無く、読み直すと入力した内容が消える。
 */
export function shouldReloadAfter(error: unknown, action: CategoryAction): boolean {
  if (action === 'create' || action === 'create-update') return false;
  if (!(error instanceof CategoryRejectedError)) return false;
  // 見直しの確認は、サーバーが断った理由（競合・脱退が確定して直せない403・メンバーでない404）のとき、読み直す。読み直さないと、
  // 押しても消えないお知らせが残る。読み直したあと、403は `editable` が false になってお知らせが消え、404は読み直しの
  // `loadGroup` も失敗してホームが読み込みの失敗の画面になる。409は、最新の状態で出し直す（印が残っていればお知らせも残る）。
  // 同じ確認の送り直しは、結果が同じ（印が無いだけ）。形の違い（400。`reason` が無い）は、読み直しても同じ
  if (action === 'acknowledge-reset') return error.reason === 'conflict' || error.reason === 'forbidden' || error.reason === 'not_found';
  // 並べ替えは、費目の顔ぶれが違う（`categories_changed`）ときだけ。`conflict`（書き込みの競合が2回続いた）は、費目が変わったという
  // 意味ではなく、作った並びはそのまま有効なので、読み直さず、同じ並びを送り直してもらう。メンバーの増減・月が締まった、は
  // 並べ替えでは起きない
  if (action === 'reorder') return error.reason === 'categories_changed';
  return (
    error.reason === 'conflict' ||
    error.reason === 'members_changed' ||
    error.reason === 'categories_changed' ||
    error.reason === 'month_closed'
  );
}

/**
 * 追加（作成の呼び出し）の 409 `conflict`。理由は2つあり、どちらも**作られていない**: この `id` を他のグループが使っている、
 * 書き込みの競合が2回続いた（Workerの `writeFailure`）。前者は、同じ `id` で送り直しても同じ失敗になるので、画面は新しい `id` に
 * する（後者でも、作られていないので、新しい `id` にして安全）。**作成が済んだあとの `PATCH` の 409 には使わない**（作成は
 * 済んでいるので、新しい `id` にすると、同じカテゴリが2つできる。`create-update`）。
 */
export function isCreateConflict(error: unknown): boolean {
  return error instanceof CategoryRejectedError && error.reason === 'conflict';
}

/**
 * 送ったあと、サーバーで済んだか分からない失敗か（サーバーが断った場合は、済んでいない）。追加で、これに当たったあとに入力を
 * 直して送り直すと、サーバーは同じ `id` の再送に、保存済みの費目をそのまま返す（内容は見比べない）ので、直した内容が反映
 * されない。そのため、画面は送り直したあとに、直した内容を `PATCH` で送る。
 */
export function resultUnknown(error: unknown): boolean {
  return !(error instanceof CategoryRejectedError);
}

/**
 * 並べ替えの保存が失敗したあと、画面をどうするか。
 * - `reload`: 費目が変わった（`categories_changed`）。並べ替えをやめて、読み直す。
 * - `exit`: 送り直しても通らない（脱退が確定していて変えられない・グループやカテゴリが見つからない）。並べ替えをやめる
 *   （読み直しても同じ。「保存」を押せるまま残すと、何度押しても同じ失敗になる）。
 * - `keep`: 並びを残して、「保存」を押し直してもらう（通信の失敗・競合など。同じ並びを送り直しても、結果は同じ）。
 */
export type ReorderFailureOutcome = 'reload' | 'exit' | 'keep';

export function reorderFailureOutcome(error: unknown): ReorderFailureOutcome {
  if (shouldReloadAfter(error, 'reorder')) return 'reload';
  if (error instanceof CategoryRejectedError && (error.reason === 'forbidden' || error.reason === 'not_found')) return 'exit';
  return 'keep';
}

/**
 * 並べ替えを保存する前に、画面の並びが、読み込んだ費目と合わなくなっていたとき（読み直しで、費目が増えた・アーカイブした・
 * 戻した）の文言。サーバーに送れば `categories_changed` で断られる場合と同じなので、同じ文言にする（送らずに、画面が読み直す）。
 */
export function staleReorderMessage(): string {
  return categoryErrorMessage(new CategoryRejectedError(409, { reason: 'categories_changed' }), 'reorder');
}

export function categoryErrorMessage(error: unknown, action: CategoryAction): string {
  const message = baseMessage(error, action);
  // 追加で、作成は済んだあとの失敗: どの失敗でも、文の頭で、カテゴリは追加できたことを伝える（そうしないと、通信の失敗などで、
  // 追加できなかったと思ってシートを閉じる。カテゴリは作られている）。すでに頭にある文言（競合・食い違い）は、重ねない
  if (action === 'create-update' && !message.startsWith(FAILED['create-update'])) return `${FAILED['create-update']}${message}`;
  return message;
}

/**
 * 閉じる・「使わない」で、捨てることになる入力の説明。追加で作成が済んでいれば、カテゴリはもうできていて、名前などは追加した
 * ときの内容のまま（直した内容は反映されていない）。編集で名前などが保存済みなら、それは残る。
 */
export function unsavedChangesNote(state: { created: boolean; profileSaved: boolean }): string {
  if (state.created) return 'カテゴリは、すでに追加されています。入力した変更は保存されず、名前などは追加したときの内容のままです。';
  if (state.profileSaved) return '先に保存した名前・アイコン・色は、そのまま残ります。ほかの入力した変更は保存されません。';
  return '入力した変更は保存されません。';
}

function baseMessage(error: unknown, action: CategoryAction): string {
  if (error instanceof CategoryRejectedError) {
    switch (error.reason) {
      case 'conflict':
        // 追加の 409 は、他のメンバーの操作との競合ではない（`isCreateConflict`）。入力は残っているので、もう一度押してもらう
        if (action === 'create' || action === 'create-update') return `${FAILED[action]}もう一度お試しください。`;
        // 並べ替えは、読み直さない（`shouldReloadAfter`）。並びは残っているので、もう一度押してもらう
        if (action === 'reorder') return '他の操作と重なりました。もう一度お試しください。';
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
