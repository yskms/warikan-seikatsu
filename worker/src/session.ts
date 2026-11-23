// セッションの発行・認証・失効。Singfolio（worker/src/session.ts）からのコピー（コピー元: singfolio 61e0a82）。
// コメントの「§8」「7.3.x」は Singfolio の docs の章番号で、ここでは読めない。
// コピーしていないもの: `revokeOtherSessions`（「ほかの端末をすべてログアウト」。このアプリでは、まだ画面もAPIも無い）。
// `markUserActiveStatement` は、Singfolioでは account.ts にあるが、ここでは、使うのがこのファイルだけなので、ここに置く。
// `users.last_active_at` は、ここ（と identity.ts）で書くだけで、読む処理が無い。Singfolioでは、未使用のアカウントの自動削除
// （inactiveAccounts.ts）が読むが、このアプリには、まだ無い（docs/backend-design.md 12章）。`revokeSession` のコメントの
// 「ログアウトの1か月後に、未使用1年として消える」は、その自動削除がある、Singfolioの前提。
// Singfolio側を直したときは、差分を手で取り込む（docs/backend-design.md 1章）。
//
// セッションの値は、不透明なランダム値（32バイト = base64url の43字。JWTにしない）。D1の `sessions` には
// ハッシュ（SHA-256 の base64url）だけを置き、値そのものは端末のSecureStoreにだけある。値は
// `Authorization: Bearer <値>` で送る（URLに載せない）。ログにも出さない。

import type { IdTokenProvider } from './idToken.ts';
import { toBase64Url } from './nonce.ts';

// 期限は、最後の利用から90日（目安）。最後の利用の時刻（`last_used_at`）は、前回の書き込みから24時間以上
// たったときだけ書くので、期限は実際の最後の利用から、最大24時間早まる。
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// 毎回書くと、D1のFreeの書き込みの上限（10万行/日）を、認証済みのリクエストの数だけ消費する。
export const SESSION_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BEARER_PATTERN = /^bearer ([A-Za-z0-9_-]{43})$/i;

export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

// 値は256ビットの乱数なので、ソルトの無い SHA-256 でよい（総当たりで引ける短い値ではない）。
export async function hashToken(token: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

/** `Authorization: Bearer <値>` から、セッションの値を取り出す。無い・形が違うなら null。 */
export function sessionTokenFromRequest(request: Request): string | null {
  return BEARER_PATTERN.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
}

/**
 * アカウントの最後に使った時刻を進める文。時計が戻る値は書かない。NULL は埋める。
 * 書き込みを増やしすぎないよう、呼び出し側が、すでに書く操作（24時間に1回のセッションの更新など）に付ける。
 */
export function markUserActiveStatement(db: D1Database, userId: string, now: number): D1PreparedStatement {
  return db
    .prepare('UPDATE users SET last_active_at = ?1 WHERE id = ?2 AND (last_active_at IS NULL OR last_active_at < ?1)')
    .bind(now, userId);
}

/**
 * セッションを発行して、値を返す（D1に置くのはハッシュだけ）。
 * 同じログイン手段（`identity`）の、期限を過ぎたセッションを、同じバッチで消す（Cron Triggerは使わない）。
 * 全体を掃除しない（`identity_id` の索引で引けるので、件数が増えても、ログインの費用が増えない）。
 * 二度とログインしない人の、期限を過ぎた行は残る（1行は小さく、認証には使えない）。
 *
 * **発行しないことがある（null）**: ログイン手段の行が無い（直前にAppleの `account-deleted` で消えた）、または
 * `consent_revoked_at`（Appleの `consent-revoked` の `event_time`）が、このログインの開始時刻（`now`）と同じか、それより後。
 * 同じミリ秒は、取り消しより前と見る（通知の削除の条件 `created_at <= event_time` と同じ側。通知とログインのどちらが先でも、
 * 取り消しと同じ時刻に始まったログインのセッションは、残らない）。
 * ログインは、検証を通ったあと、ここへ来るまでの間に、通知の処理が入りうる。通知を先に処理した場合のセッションを、
 * ここで作らない（通知を後に処理した場合は、通知が消す）。条件は INSERT の1文の中で見るので、通知の処理
 * （削除と記録の1バッチ）と、どちらが先でも、取り消し後のセッションは残らない（migrations/0001_auth.sql の
 * `consent_revoked_at`）。通知の処理は appleNotification.ts。
 */
export async function createSession(db: D1Database, identityId: string, now: number): Promise<string | null> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const [, insert] = await db.batch([
    db.prepare('DELETE FROM sessions WHERE identity_id = ?1 AND last_used_at <= ?2').bind(identityId, now - SESSION_TTL_MS),
    db
      .prepare(
        `INSERT INTO sessions (token_hash, identity_id, created_at, last_used_at)
         SELECT ?1, ?2, ?3, ?3
         WHERE EXISTS (SELECT 1 FROM identities WHERE id = ?2 AND (consent_revoked_at IS NULL OR consent_revoked_at < ?3))`,
      )
      .bind(await hashToken(token), identityId, now),
  ]);
  return insert!.meta.changes === 1 ? token : null;
}

export interface AuthenticatedSession {
  userId: string;
  identityId: string;
  /** このセッションを作ったログイン手段の `sub`（アカウントの削除の再認証で、同じアカウントか確かめる）。 */
  sub: string;
  /** このセッションを作ったログイン手段。 */
  provider: IdTokenProvider;
}

/**
 * セッションの値から、ユーザーを引く。無い・期限切れ・形が違うなら null（理由は区別しない）。
 * ユーザーIDは、クライアントから受け取らず、ここで得たものだけを使う。
 * 通ったとき、`last_used_at` が24時間以上前なら、更新する（それより新しければ書かない）。
 * 期限を過ぎた行は、見つかった時点で消す。
 */
export async function authenticateSession(
  db: D1Database,
  token: string,
  now: number,
): Promise<AuthenticatedSession | null> {
  if (!isSessionToken(token)) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT s.last_used_at AS last_used_at, s.identity_id AS identity_id, i.user_id AS user_id, i.provider AS provider, i.sub AS sub
       FROM sessions s JOIN identities i ON i.id = s.identity_id
       WHERE s.token_hash = ?1`,
    )
    .bind(hash)
    .first<{ last_used_at: number; identity_id: string; user_id: string; provider: IdTokenProvider; sub: string }>();
  if (row === null) return null;

  const idle = now - row.last_used_at;
  if (idle >= SESSION_TTL_MS) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
    return null;
  }
  if (idle >= SESSION_TOUCH_INTERVAL_MS) {
    // 同時の2つのリクエストが両方書いても、同じ値になる。時計が戻る値は書かない。
    // アカウントの最後に使った時刻（未使用のアカウントの自動削除の基準）も、セッションと同じ頻度（24時間に1回）で進める。
    await db.batch([
      db.prepare('UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2 AND last_used_at < ?1').bind(now, hash),
      markUserActiveStatement(db, row.user_id, now),
    ]);
  }
  return { userId: row.user_id, identityId: row.identity_id, sub: row.sub, provider: row.provider };
}

/**
 * セッションを失効させる（行の削除）。無い値でも成功にする（何度呼んでも結果が同じ。ログアウトは、
 * 値を持っている側だけが呼べる）。
 * 消す前に、そのセッションのアカウントの最後に使った時刻を進める（同じバッチ。消すと、アカウントを引けなくなる）。
 * ログアウトは、アプリを使った操作で、これで「ログアウトの1か月後に、未使用1年として消える」穴を塞ぐ。
 * **期限切れ（`SESSION_TTL_MS` 以上使っていない）のセッションでは進めない**（行は消す）。`authenticateSession` が、期限切れでは
 * 時刻を進めないのと揃える: 最後に使った時刻は、有効なセッションか、サインインの成功でだけ進む。古い端末に残った値でのログアウトで、
 * アカウントの期限を延ばさない。期限切れの行は、次の `createSession` まで残りうる。
 */
export async function revokeSession(db: D1Database, token: string, now: number): Promise<void> {
  if (!isSessionToken(token)) return;
  const hash = await hashToken(token);
  await db.batch([
    db
      .prepare(
        `UPDATE users SET last_active_at = ?1
         WHERE id = (SELECT i.user_id FROM sessions s JOIN identities i ON i.id = s.identity_id
                     WHERE s.token_hash = ?2 AND s.last_used_at > ?3)
           AND (last_active_at IS NULL OR last_active_at < ?1)`,
      )
      .bind(now, hash, now - SESSION_TTL_MS),
    db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash),
  ]);
}
