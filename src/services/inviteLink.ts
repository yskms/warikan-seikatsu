// アプリに渡されたURLが招待URLか、そうならトークンを取り出す。
//
// 招待URLの形は2つ（どちらも道は `/invite/<token>`。`inviteUrl.ts`）:
// - `https://<INVITE_URL_ORIGIN>/invite/<token>`: 共有するURL。Universal Links / App Links で、アプリが入っていれば直接アプリが開く
//   （置き場のドメインと、その設定は未決。`inviteUrl.ts` の先頭）。
// - `warikan-seikatsu://invite/<token>`: アプリのURLスキーム。メッセージアプリでは押せないが、動作確認（`adb shell am start`・
//   `xcrun simctl openurl`）と、置き場が決まる前の確認に使える。
// ほかの置き場・ほかの道は、招待URLとして扱わない（他のアプリが押し込んだURLで、参加の確認が出ないように）。
//
// 開いただけでは参加しない。ここで取り出したトークンは、ログイン後の参加確認へ渡す（`pendingInvite.ts`）。
import { INVITE_URL_ORIGIN } from './inviteUrl.ts';

/** アプリのURLスキーム（`app.json` の `scheme`）の、招待の入口 */
export const INVITE_SCHEME_PREFIX = 'warikan-seikatsu://invite/';

// Workerの `isInviteToken`（`worker/src/invites.ts`）と同じ形: 256ビットの乱数のbase64url（43字）
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// 常識的な長さを超えるURLは、読まずに捨てる
const MAX_URL_LENGTH = 2048;

/** `url` の先頭が `prefix`（スキームとホストは、大文字小文字を区別しない）なら、その後ろを返す。 */
function after(url: string, prefix: string): string | null {
  return url.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase() ? url.slice(prefix.length) : null;
}

/**
 * 招待URLなら、トークンを返す。そうでなければ `null`。クエリ・フラグメント・末尾の `/` は無視する。
 * `origin` は、招待URLの置き場（既定は `INVITE_URL_ORIGIN`）。
 */
export function parseInviteLink(url: string, origin: string = INVITE_URL_ORIGIN): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  const rest = after(url, INVITE_SCHEME_PREFIX) ?? after(url, `${origin.replace(/\/+$/, '')}/invite/`);
  if (rest === null) return null;
  const end = rest.search(/[?#]/);
  const segment = (end === -1 ? rest : rest.slice(0, end)).replace(/\/$/, '');
  return TOKEN_PATTERN.test(segment) ? segment : null;
}
