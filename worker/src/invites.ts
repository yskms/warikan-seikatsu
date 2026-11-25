// 招待の発行・一覧・取り消し・確認、参加。規則は docs/backend-design.md 1章・5章、形は9章「招待・参加・脱退」。
//
// - 招待トークンは、256ビットの乱数（base64url の43字）。平文は保存せず、SHA-256 のハッシュを保存する。
//   値は発行の応答で1回だけ返す（あとから取り出せない）。期限は発行から3日、使い捨て。
// - URLを開いただけでは参加しない。確認（`GET /invites/:token`）は、グループ名と招待元を返すだけ。
//   参加（`POST /invites/:token/join`）の時点で、期限・未使用・未取り消しを確かめて、参加処理を行う。
// - 参加は、やり直さずに、競合したら409を返す（8章。同じ招待で同時に参加しようとしても、片方は409）。
//   発行と取り消しは、読み直して1回だけやり直す。
// - 使えない招待（知らないトークン・期限切れ・使用済み・取り消し済み・発行者が抜けた）は、区別せず404
//   `invite_unavailable`（どの状態かを教えない）。
//
// 書き込みの前に、先に `readDataVersion` でバージョンを読み、そのあとでデータを読む（groupWrite.ts 冒頭の注意1）。
import {
  authenticateRequest,
  canIssueInvites,
  isLeaveEffectiveFor,
  latestClosedMonth,
  loadGroupAccess,
} from './access.ts';
import {
  GROUP_WRITE_GUARD,
  insertRowsGuarded,
  readDataVersion,
  writeToGroup,
  writeToGroupWithRetry,
} from './groupWrite.ts';
import { conflict, forbidden, invalidRequest, json, noContent, notFound, readJsonObject, unauthorized } from './http.ts';
import { parseJoin } from './memberInput.ts';
import {
  firstResettableMonth,
  isGroupFull,
  loadCategoryIds,
  loadMembers,
  loadRuleMonthsAfter,
  pauseRecurringStatements,
  pickMemberColor,
  resetMonthsStatements,
} from './membership.ts';
import { monthIn } from './months.ts';
import { toBase64Url } from './nonce.ts';
import { hashToken } from './session.ts';

/** 招待の有効期間（発行から3日）。 */
export const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** 1人が同時に持てる、未使用で期限内の招待の数。無制限に作られて、招待の行が増え続けるのを避ける。 */
export const MAX_UNUSED_INVITES_PER_MEMBER = 10;

const MAX_BODY_BYTES = 1024;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

const inviteUnavailable = (): Response => json({ error: 'invite_unavailable' }, 404);
/** グループの人数が上限（`MAX_MEMBERS_PER_GROUP`）。 */
const groupFull = (): Response => conflict('group_full');

// ---------------------------------------------------------------------------
// POST /groups/:id/invites

export async function handleCreateInvite(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashToken(token);
  const inviteId = crypto.randomUUID();
  const expiresAt = now + INVITE_TTL_MS;

  const outcome = await writeToGroupWithRetry<null, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    // 脱退が確定した（`leaving` 以降）メンバーは、招待を発行できない（5章）。
    if (!canIssueInvites(access, now)) return { reject: forbidden() };
    const unused = await db
      .prepare(
        `SELECT count(*) AS n FROM invites
          WHERE group_id = ?1 AND invited_by_member_id = ?2 AND consumed_at IS NULL AND revoked_at IS NULL
            AND expires_at > ?3`,
      )
      .bind(groupId, access.member.id, now)
      .first<{ n: number }>();
    if ((unused?.n ?? 0) >= MAX_UNUSED_INVITES_PER_MEMBER) return { reject: conflict('too_many_invites') };
    // 人数が上限なら、招待しても参加できない。発行の時点で断る（参加でも、もう一度見る）。
    const members = await loadMembers(db, groupId);
    if (isGroupFull(members, access.group.timezone, now)) return { reject: groupFull() };
    return {
      write: (writeToken: string) =>
        insertRowsGuarded(
          db,
          writeToken,
          groupId,
          'invites',
          ['id', 'group_id', 'invited_by_member_id', 'token_hash', 'expires_at', 'created_at'],
          [[inviteId, groupId, access.member.id, tokenHash, expiresAt, now]],
        ),
      value: null,
    };
  });
  switch (outcome.status) {
    case 'written':
      // 招待の平文は、この応答でだけ返す。
      return json({ invite: { id: inviteId, token, expiresAt, createdAt: now } }, 201);
    case 'rejected':
      return outcome.reject;
    case 'no_group':
      return notFound();
    default:
      return conflict('conflict');
  }
}

// ---------------------------------------------------------------------------
// GET /groups/:id/invites（自分が発行した、未使用で期限内の招待。「取り消す」の一覧のため）

export async function handleListInvites(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;
  const access = await loadGroupAccess(db, session.userId, groupId);
  if (access === null) return notFound();
  const { results } = await db
    .prepare(
      `SELECT id, expires_at, created_at FROM invites
        WHERE group_id = ?1 AND invited_by_member_id = ?2 AND consumed_at IS NULL AND revoked_at IS NULL
          AND expires_at > ?3
        ORDER BY created_at, id`,
    )
    .bind(groupId, access.member.id, now)
    .all<{ id: string; expires_at: number; created_at: number }>();
  return json({ invites: results.map((row) => ({ id: row.id, expiresAt: row.expires_at, createdAt: row.created_at })) });
}

// ---------------------------------------------------------------------------
// DELETE /invites/:id（発行した人だけ）

interface InviteState {
  invited_by_member_id: string;
  consumed_at: number | null;
  revoked_at: number | null;
}

export async function handleRevokeInvite(request: Request, env: Env, now: number, inviteId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  // 招待の属するグループ。権限の確認は、このあと groupId で行う（IDだけでは何も見せない）。
  const found = await db
    .prepare('SELECT group_id FROM invites WHERE id = ?')
    .bind(inviteId)
    .first<{ group_id: string }>();
  if (found === null) return notFound();
  const groupId = found.group_id;

  const outcome = await writeToGroupWithRetry<null, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    const invite = await db
      .prepare('SELECT invited_by_member_id, consumed_at, revoked_at FROM invites WHERE id = ?1 AND group_id = ?2')
      .bind(inviteId, groupId)
      .first<InviteState>();
    // 発行した人以外には、無いものとして扱う（他のメンバーの招待の存在を教えない）。
    if (invite === null || invite.invited_by_member_id !== access.member.id) return { reject: notFound() };
    if (invite.consumed_at !== null) return { reject: conflict('invite_already_used') };
    // すでに取り消し済みなら、そのまま成功にする（二重に押しても同じ結果）。
    if (invite.revoked_at !== null) return { reject: noContent() };
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE invites SET revoked_at = ?
              WHERE id = ? AND group_id = ? AND consumed_at IS NULL AND revoked_at IS NULL
                AND EXISTS (${GROUP_WRITE_GUARD})`,
          )
          .bind(now, inviteId, groupId, groupId, token),
      ],
      value: null,
    };
  });
  switch (outcome.status) {
    case 'written':
      return noContent();
    case 'rejected':
      return outcome.reject;
    case 'no_group':
      return notFound();
    default:
      return conflict('conflict');
  }
}

// ---------------------------------------------------------------------------
// 招待の引き当て（確認・参加）

interface InviteRow {
  id: string;
  group_id: string;
  expires_at: number;
  consumed_at: number | null;
  revoked_at: number | null;
  group_name: string;
  timezone: string;
  inviter_name: string;
  inviter_status: string;
  inviter_leave_requested_month: string | null;
}

async function findInviteByHash(db: D1Database, tokenHash: string): Promise<InviteRow | null> {
  return db
    .prepare(
      `SELECT i.id AS id, i.group_id AS group_id, i.expires_at AS expires_at, i.consumed_at AS consumed_at,
              i.revoked_at AS revoked_at, g.name AS group_name, g.timezone AS timezone,
              m.display_name AS inviter_name, m.status AS inviter_status,
              m.leave_requested_month AS inviter_leave_requested_month
         FROM invites i
         JOIN expense_groups g ON g.id = i.group_id
         JOIN group_members m ON m.id = i.invited_by_member_id AND m.group_id = i.group_id
        WHERE i.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<InviteRow>();
}

/**
 * 参加に使える招待か。未使用・未取り消し・期限内で、発行した人が、まだ招待を発行できる状態（脱退が確定したものとして
 * 扱わない）であること。発行した人の脱退が確定すれば、その人の招待は取り消されるが、Cronが確定させるまでの間も
 * 使えないようにする（`isLeaveEffectiveFor`。access.ts の `isLeaveEffective` と同じ判定）。
 */
function isUsable(invite: InviteRow, now: number): boolean {
  if (invite.consumed_at !== null || invite.revoked_at !== null || invite.expires_at <= now) return false;
  return !isLeaveEffectiveFor(
    { status: invite.inviter_status, leaveRequestedMonth: invite.inviter_leave_requested_month },
    invite.timezone,
    now,
  );
}

// ---------------------------------------------------------------------------
// GET /invites/:token（招待内容の確認。要ログイン。参加はしない）

export async function handleGetInvite(request: Request, env: Env, now: number, token: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  const invite = await findInviteByHash(db, await hashToken(token));
  if (invite === null) return inviteUnavailable();

  // すでにそのグループに参加中なら、グループを開くだけにする（使用済みの招待でも。画面設計メモ「参加確認」）。
  const existing = await db
    .prepare('SELECT status FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(invite.group_id, session.userId)
    .first<{ status: string }>();
  if (existing !== null && (existing.status === 'active' || existing.status === 'leaving')) {
    return json({ alreadyMember: true, groupId: invite.group_id });
  }

  if (!isUsable(invite, now)) return inviteUnavailable();
  // 満員なら、表示名を入力させる前に知らせる(参加は 409 `group_full`。人数の数え方は参加と同じ)。
  const members = await loadMembers(db, invite.group_id);
  return json({
    alreadyMember: false,
    groupName: invite.group_name,
    invitedByDisplayName: invite.inviter_name,
    expiresAt: invite.expires_at,
    groupFull: isGroupFull(members, invite.timezone, now),
  });
}

// ---------------------------------------------------------------------------
// POST /invites/:token/join

interface ExistingMemberRow {
  id: string;
  user_id: string | null;
  color: string;
  status: string;
}

export async function handleJoin(request: Request, env: Env, now: number, token: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseJoin(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const { displayName } = parsed.value;

  const tokenHash = await hashToken(token);
  const first = await findInviteByHash(db, tokenHash);
  if (first === null) return inviteUnavailable();
  const groupId = first.group_id;

  // バージョンが先。そのあとで、招待・メンバー・費目などのデータを読む。
  const version = await readDataVersion(db, groupId);
  if (version === null) return inviteUnavailable();
  const invite = await findInviteByHash(db, tokenHash);
  const { results: memberRows } = await db
    .prepare('SELECT id, user_id, color, status FROM group_members WHERE group_id = ?')
    .bind(groupId)
    .all<ExistingMemberRow>();
  const mine = memberRows.find((row) => row.user_id === session.userId) ?? null;
  if (mine !== null && (mine.status === 'active' || mine.status === 'leaving')) {
    return conflict('already_member', { groupId });
  }
  if (invite === null || !isUsable(invite, now)) return inviteUnavailable();

  const members = await loadMembers(db, groupId);
  // 人数の上限（発行のあとに、ほかの招待で埋まったとき）。参加する本人は、まだ数えに入っていない（未参加か `left`）。
  if (isGroupFull(members, invite.timezone, now)) return groupFull();
  const categoryIds = await loadCategoryIds(db, groupId);
  const latestClosed = await latestClosedMonth(db, groupId);

  // 参加月は、グループのタイムゾーンの今月。履歴を見られるのは、参加月から（5章）。
  const joinMonth = monthIn(invite.timezone, now);
  // 割合をリセットする月。参加月がすでに締められていれば（早めに締めた後）、締めた月は触れないので、翌月。
  const resetMonth = firstResettableMonth(joinMonth, latestClosed);
  // 一度脱退した人（`left`）は、元のメンバー行に戻す（5章）。
  const memberId = mine?.id ?? crypto.randomUUID();
  const color = pickMemberColor(
    memberRows.filter((row) => row.status === 'active' || row.status === 'leaving').map((row) => row.color),
    mine?.color ?? null,
  );
  const ruleMonths = await loadRuleMonthsAfter(db, groupId, resetMonth);
  const joined = {
    id: memberId,
    displayName,
    status: 'active' as const,
    historyFromMonth: joinMonth,
    expenseEndMonth: null,
    leaveRequestedMonth: null,
  };
  const membersAfter = [...members.filter((member) => member.id !== memberId), joined];

  const written = await writeToGroup(db, groupId, version, (writeToken) => [
    // 0: メンバーの追加（または復帰）。
    ...(mine === null
      ? insertRowsGuarded(
          db,
          writeToken,
          groupId,
          'group_members',
          ['id', 'group_id', 'user_id', 'display_name', 'color', 'status', 'history_from_month', 'joined_at'],
          [[memberId, groupId, session.userId, displayName, color, 'active', joinMonth, now]],
        )
      : [
          db
            .prepare(
              `UPDATE group_members
                  SET status = 'active', display_name = ?, color = ?, history_from_month = ?, joined_at = ?,
                      leave_requested_month = NULL, expense_end_month = NULL, left_at = NULL
                WHERE id = ? AND group_id = ? AND status = 'left' AND EXISTS (${GROUP_WRITE_GUARD})`,
            )
            .bind(displayName, color, joinMonth, now, memberId, groupId, groupId, writeToken),
        ]),
    // 1: 招待を使用済みにする。
    db
      .prepare(
        `UPDATE invites SET consumed_at = ?, consumed_by_member_id = ?
          WHERE id = ? AND group_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
            AND EXISTS (${GROUP_WRITE_GUARD})`,
      )
      .bind(now, memberId, invite.id, groupId, now, groupId, writeToken),
    // 参加月の全費目の割合を、新しいメンバーを含めた均等にリセットし、上限額の設定を外す（5章）。それより後の月に
    // 行があれば（アカウント削除が、未締めの翌月に書いたものなど）、それも直す。
    ...resetMonthsStatements(db, writeToken, groupId, {
      members: membersAfter,
      categoryIds,
      baseMonths: [resetMonth],
      ruleMonths,
      now,
    }),
    // `category` 以外の固定費は、自動登録を止める（5章）。
    ...pauseRecurringStatements(db, writeToken, groupId, now, { payerMemberIds: [], memberChanged: true }),
  ]);
  // 'version'（同じ招待で同時に参加しようとした、ほかの書き込みと競合した）も、'unique' も、やり直さない（8章）。
  if (!written.ok) return conflict('conflict');
  // 上で確かめた状態は、バージョンを読んだあとのもの。バージョンが合っていれば、必ず1件に効く。
  // 0件なら、その前提が崩れている（実装の誤り）ので、成功にしない。
  // 0番目はメンバーの追加（復帰）、1番目は招待の使用済み化。
  if (written.results[0]?.meta.changes !== 1 || written.results[1]?.meta.changes !== 1) return conflict('conflict');

  return json({ groupId, memberId }, 201);
}
