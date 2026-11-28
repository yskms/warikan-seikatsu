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

// 貼り付けられた文字の長さの上限。招待の文面ごと貼られても、常識的な長さに収まる
const MAX_TEXT_LENGTH = 10_000;
// URLに使える文字（RFC 3986）の並び。空白・全角の句読点・括弧などで切れる
const URL_RUN = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
// 文中のURLの直後に付く、句読点・閉じ括弧（「…/invite/xxxx.」「（…/invite/xxxx）」）
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * 貼り付けられた文字の中から、招待URLを探して、トークンを返す。なければ `null`。
 * 招待URLだけでなく、**招待の文面ごと**（前後に説明の文があるもの。`URL:` のような前置きが付くものも）読める。複数あれば、
 * 先に見つかったものを返す。URLの形の判定は `parseInviteLink` に任せる（置き場・道・トークンの形。ほかのURLは、招待として扱わない）。
 * 「参加の確認」へ渡すだけで、これで参加するわけではない（`pendingInvite.ts`）。
 */
export function findInviteToken(text: string, origin: string = INVITE_URL_ORIGIN): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) return null;
  const prefixes = [INVITE_SCHEME_PREFIX, `${origin.replace(/\/+$/, '')}/invite/`].map((prefix) => prefix.toLowerCase());
  for (const run of text.match(URL_RUN) ?? []) {
    const cleaned = run.replace(TRAILING_PUNCTUATION, '');
    const lower = cleaned.toLowerCase();
    for (const prefix of prefixes) {
      // 前置き（`URL:` など）が付いていても読めるよう、かたまりの中の、置き場の先頭から読む
      for (let from = lower.indexOf(prefix); from !== -1; from = lower.indexOf(prefix, from + 1)) {
        const token = parseInviteLink(cleaned.slice(from), origin);
        if (token !== null) return token;
      }
    }
  }
  return null;
}
