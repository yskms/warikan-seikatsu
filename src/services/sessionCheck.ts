// 起動時（とアプリが前面に戻ったとき）の「ログイン済みか」の判定。画面の仕様は docs/screens.md 1章の最後の項目。
// `accountService.getSignedInProvider` は、端末の保存先を読めないと `storage-failed` を投げる（「ログアウト中」と
// 「分からない」を取り違えないため。docs/backend-design.md 9章の「サインインの層」）。端末がロック中の一時的な失敗かもしれない
// ので、短い間隔で数回、読み直す。**壊れた値のように、ずっと続くこともある**ので、直らなければ `unreadable` を返し、画面は
// ログイン画面を出す（読めないまま、先へ進めなくならないようにする）。
import type { AccountService } from './accountService.ts';

export type SessionCheck =
  /** サインイン中 */
  | 'signed-in'
  /** サインインしていない */
  | 'signed-out'
  /** 読み直しても、保存先を読めなかった（ログイン画面を出す。ログインすれば、読めない値は上書きされる） */
  | 'unreadable';

/** 読み直すまでの待ち（ミリ秒）。最初の1回と合わせて4回読み、最長で約3.5秒待つ。 */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

/**
 * 判定全体の上限（ミリ秒）。読み込みが返ってこない（止まった）ときも、ここで `unreadable` として打ち切り、ログイン画面を
 * 出す。調べているあいだは、スプラッシュを出したままにしているので、打ち切らないと、起動しないように見える。
 * 読み直しの待ちの合計（約3.5秒）より長くする。
 */
export const CHECK_DEADLINE_MS = 8000;

export interface SessionCheckOptions {
  /** 読み直すまでの待ち。既定は `RETRY_DELAYS_MS`。テスト用 */
  delaysMs?: readonly number[];
  /** 判定全体の上限。既定は `CHECK_DEADLINE_MS`。テスト用 */
  deadlineMs?: number;
  /** 待つ関数。テスト用 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 1回だけ読む。読めなかった失敗（`storage-failed`・`unexpected`）は、投げずに `unreadable` で返す。 */
export async function checkSessionOnce(account: Pick<AccountService, 'getSignedInProvider'>): Promise<SessionCheck> {
  try {
    return (await account.getSignedInProvider()) === null ? 'signed-out' : 'signed-in';
  } catch {
    return 'unreadable';
  }
}

/** `unreadable` のあいだ、`delaysMs` の間隔で読み直す。直らなければ、または全体が上限を超えれば `unreadable`。 */
export async function checkSession(
  account: Pick<AccountService, 'getSignedInProvider'>,
  options: SessionCheckOptions = {},
): Promise<SessionCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SessionCheck>((resolve) => {
    timer = setTimeout(() => resolve('unreadable'), options.deadlineMs ?? CHECK_DEADLINE_MS);
  });
  try {
    // 打ち切ったあとも、読み直しは裏で続くが、結果は使わない（読み込みは副作用が無い）。
    return await Promise.race([checkWithRetry(account, options), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithRetry(
  account: Pick<AccountService, 'getSignedInProvider'>,
  options: SessionCheckOptions,
): Promise<SessionCheck> {
  const delaysMs = options.delaysMs ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  let result = await checkSessionOnce(account);
  for (const delay of delaysMs) {
    if (result !== 'unreadable') break;
    await sleep(delay);
    result = await checkSessionOnce(account);
  }
  return result;
}
