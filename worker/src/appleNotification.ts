// Apple のサーバー間通知（POST /auth/apple/notifications）。Singfolio（worker/src/appleNotification.ts）からのコピー
// （コピー元: singfolio 61e0a82）。コメントの「§8」「7.3.x」「7.4.5」は Singfolio の docs の章番号で、ここでは読めない。
// 方式と理由は、Singfolio の docs/singfolio-publishing-backend.md §8「Appleのサーバー間通知」と、このリポジトリの
// docs/backend-design.md 9章の「認証API」。Singfolio側を直したときは、差分を手で取り込む（docs/backend-design.md 1章）。
//
// このアプリで変えたところ:
// - アカウントごと消す処理（Singfolioの `deleteUserAccount`。R2の掃除もある）は、このアプリでは `accountDeletion.ts` の
//   `deleteAccount`（グループの匿名化・削除と、`users` の行の削除。`POST /auth/delete` と同じ）。`deleteAccountData` として読み込む。
//   競合し続けると何も変えずに `conflict` を返すので、Singfolioの `storage-unavailable`（R2を消せなかった）と同じく、503にする
//   （Appleが再送するかは分からない。再送されなければ、そのアカウントは、自動では消えないまま残る）。
// - R2（`SNAPSHOTS`）は無いので、`env` は `DB` だけ。
// - `account-deleted` でアカウントごと消すとき、**データを消す前に**、その行のセッションを先に消す（Singfolioには無い）。
//   データの削除は、競合し続ける（503）、D1のクエリ数の上限に当たる（例外）などで、何も消せないことがあり、そのまま
//   だと、Apple Accountを消した人のセッションが、ログイン中の端末から使える状態で残る。先に消しておけば、データの削除が
//   どう失敗しても、セッションは残らない（消えるものは、セッションだけ。グループのデータは、再送されたときに消える）。
//   消した後の、データの削除の結果は変わらない（アカウントごと消えれば、セッションは外部キーでも消える）。
//
// Apple が、アプリとの連携の解除（`consent-revoked`）と、Apple Account の削除（`account-deleted`）を、
// 登録したエンドポイントへ送る（primary App ID に登録する。デプロイのあとに、利用者が行う）。本文は
// `{"payload":"<JWS>"}`。署名・`iss`・`aud` を確かめてから、種類ごとに処理する。
//
// 守ること:
// - 検証に通る前は、D1に触れない。通ったあとも、知らない種類（`email-enabled` など）は何もしない。
// - 同じ通知が何度届いても、結果は同じにする（Apple は同じ通知を繰り返し送る、という報告がある）。
// - `consent-revoked` は、取り消しの時点（`event_time`）より前に作られたセッションだけを消す。あとでサインインし直した
//   （連携が戻った）端末を、届くのが遅れた古い通知で、ログアウトさせない。サインインし直した行があっても、取り消しの前から
//   生きていたほかの端末のセッションは消す。
// - `account-deleted` は、順序を見ずに処理する（消えた Apple Account は戻らない）。
// - 通知の中身（`sub`・`event_time`）・JWSを、ログに出さない。失敗の分類だけを、`console.error` に1行出す。
import { deleteAccount as deleteAccountData } from './accountDeletion.ts';
import { invalidRequest, json, methodNotAllowed, readJsonObject, serviceUnavailable, unauthorized } from './http.ts';
import { getIdTokenVerifier, type AppleNotificationEvent, type IdTokenVerifier } from './idToken.ts';

// 本文の上限。JWS は1〜2KB。
const MAX_BODY_BYTES = 16 * 1024;

/** 処理した結果。呼び出し側（テスト）が、何が起きたか見分けるためのもの。応答には出さない。 */
export type AppleEventOutcome =
  | 'ignored'
  | 'sessions-revoked'
  | 'identity-deleted'
  | 'user-deleted'
  | 'nothing'
  // アカウントごと消すとき、グループのデータの書き込みが、他の書き込みと競合し続けた（セッションは消したが、グループのデータと
  // アカウントは消していない。やり直せる）。
  | 'conflict';

/**
 * POST /auth/apple/notifications。検証に通ったら、通知を処理して 200（本文 `{}`）を返す（知らない種類・対象が
 * 無い通知も 200）。形の不備は 400、検証に通らない（どの検査かは教えない）は 401、公開鍵を取得できないは 503
 * （Apple が再送するかは分からないが、トークンの問題ではない）。
 */
export async function handleAppleNotification(
  request: Request,
  env: Env,
  now: number,
  deps: { verifier?: IdTokenVerifier; log?: (message: string) => void } = {},
): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const parsed = await readJsonObject(request, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { payload } = parsed.body;
  if (typeof payload !== 'string' || payload === '') return invalidRequest();

  const verified = await (deps.verifier ?? getIdTokenVerifier()).verifyAppleNotification({
    token: payload,
    audiences: [env.APPLE_BUNDLE_ID, env.APPLE_SERVICES_ID],
    now,
  });
  if (!verified.ok) {
    // 設定の不備（`aud` の食い違いなど）は、検証に通らない理由が見えないと切り分けられない。通知は Apple からしか
    // 来ないので、理由の分類（固定の語彙）だけを出す。トークンの中身は出さない（Workers Logs は無効。`wrangler tail` で見る）。
    (deps.log ?? ((message) => console.error(message)))(`apple notification rejected: reason=${verified.reason}`);
    return verified.reason === 'unavailable' ? serviceUnavailable() : unauthorized();
  }

  // 競合し続けたら 503（セッションは消してある。Appleが再送するかは分からない。再送されなければ、グループのデータとアカウントは、
  // 消えないまま残る。docs/backend-design.md 12章）。
  if ((await applyAppleEvent(env, verified.event, now)) === 'conflict') return serviceUnavailable();
  return json({});
}

/**
 * 検証済みの通知を処理する。
 * - `consent-revoked`: その Apple の `sub` の `identities` の行のセッションを消し、`consent_revoked_at` を記録する。
 * - `account-deleted`（`account-delete` も読む。資料の版で綴りが違うという報告がある）: その行を消す。ほかのログイン手段が
 *   無ければ、アカウントごと消す。
 * - それ以外: 何もしない。
 */
export async function applyAppleEvent(
  env: Pick<Env, 'DB'>,
  event: AppleNotificationEvent,
  now: number,
): Promise<AppleEventOutcome> {
  if (event.type === 'consent-revoked') return revokeConsent(env.DB, event);
  if (event.type === 'account-deleted' || event.type === 'account-delete') return deleteAppleIdentity(env, event.sub, now);
  return 'ignored';
}

/**
 * `consent-revoked`。1つのバッチ（トランザクション）で、セッションの削除と記録を行う。
 * - 削除: `created_at <= eventTime` の**セッション**（取り消しの時点で、すでにあったもの）。セッションの単位で判定するので、
 *   通知が届く前にサインインし直した（連携が戻った）端末のセッションは、残る。一方、取り消しの前から生きていたほかの端末のセッション
 *   （盗まれた端末のものなど）は、サインインし直した行があっても、消える。同じ通知の再送は、あとのセッションを消さない。
 *   `created_at` は、ログインの開始時刻（`createSession` に渡す `now`）。
 * - 記録: `last_sign_in_at <= eventTime`（通知のあとにサインインし直した行は、記録しない）で、`consent_revoked_at` が無い、または
 *   `eventTime` より前（同じ通知の再送は、何もしない）。`consent_revoked_at` は、`createSession` が、この通知より前に始まったログインの
 *   セッションを作らないために見る（通知の処理の最中に進んでいたログイン。このアプリでは migrations/0001_auth.sql。Singfolioの 0002）。
 */
async function revokeConsent(db: D1Database, event: AppleNotificationEvent): Promise<AppleEventOutcome> {
  const identity = `provider = 'apple' AND sub = ?1`;
  const [deleted, update] = await db.batch([
    db
      .prepare(`DELETE FROM sessions WHERE created_at <= ?2 AND identity_id IN (SELECT id FROM identities WHERE ${identity})`)
      .bind(event.sub, event.eventTime),
    db
      .prepare(
        `UPDATE identities SET consent_revoked_at = ?2
         WHERE ${identity} AND last_sign_in_at <= ?2 AND (consent_revoked_at IS NULL OR consent_revoked_at < ?2)`,
      )
      .bind(event.sub, event.eventTime),
  ]);
  return deleted!.meta.changes > 0 || update!.meta.changes === 1 ? 'sessions-revoked' : 'nothing';
}

/**
 * `account-deleted`。その Apple の `sub` の行を消す（セッションも、外部キーで消える）。最後のログイン手段なら、アカウントごと。
 *
 * **件数の確認（SELECT）と削除は、1つのトランザクションに入っていない。** 今は、`identities` の行を足すのは、ログインでの
 * `resolveIdentity`（ユーザーと行を同時に作る）だけで、既存のユーザーにログイン手段を足す処理が無いので、確認と削除の間に件数が増えない。
 * 「アカウントのつなぎ方」（既存のユーザーにログイン手段をつなぐ処理）を作るときは、ここを見直す: 確認のあとにつながった手段ごと
 * アカウントが消える、または、最後の手段だけが消えて `users` の行が残る。`accountDeletion.ts` の、グループのバージョンを
 * 読んでから書く順序（8章）とも合わせて、確認と削除を1文（条件つきの DELETE）か1バッチにできるかを決める。
 */
async function deleteAppleIdentity(
  env: Pick<Env, 'DB'>,
  sub: string,
  now: number,
): Promise<AppleEventOutcome> {
  const { DB: db } = env;
  const row = await db
    .prepare(
      `SELECT i.id AS id, i.user_id AS user_id,
              (SELECT COUNT(*) FROM identities o WHERE o.user_id = i.user_id) AS total
       FROM identities i WHERE i.provider = 'apple' AND i.sub = ?1`,
    )
    .bind(sub)
    .first<{ id: string; user_id: string; total: number }>();
  if (row === null) return 'nothing';
  if (row.total <= 1) {
    // 先にセッションを消す（理由は、ファイルの先頭）。件数の確認と同じく、これ自体は競合制御（グループのバージョン）に当たらない。
    await db.prepare('DELETE FROM sessions WHERE identity_id = ?1').bind(row.id).run();
    return (await deleteAccountData(env.DB, row.user_id, now)).status === 'deleted' ? 'user-deleted' : 'conflict';
  }
  await db.prepare('DELETE FROM identities WHERE id = ?1').bind(row.id).run();
  return 'identity-deleted';
}
