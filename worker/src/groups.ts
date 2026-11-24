// グループの作成・一覧・詳細・変更と、自分の名前・色の変更。形と規則は docs/backend-design.md 9章
// 「グループ・メンバー・招待」の「グループAPI」、初期の費目は同3章・screens.md 2章。
//
// - 作成は、グループ・自分のメンバー行・初期の費目と、その月の割合（自分100%）を、1回の `batch()` で書く。
//   新しいグループには競合する相手がいないので、バージョンは読まない。バージョンを上げる文の代わりに、
//   グループの行を `write_token` つきで作り、後続の文に同じ `GROUP_WRITE_GUARD` を付ける（`insertRowsGuarded` を
//   そのまま使える。月締めと同じ、複数行を1文にまとめる書き方）。
// - 変更（グループ名・通貨、自分の名前・色）は、読み直して1回だけやり直す（8章）。
import {
  authenticateRequest,
  canEditGroupSettings,
  canIssueInvitesFor,
  isLeaveEffectiveFor,
  loadGroupAccess,
} from './access.ts';
import { minorUnitOf } from './currencies.ts';
import { parseCreateGroup, parseUpdateGroup } from './groupInput.ts';
import {
  GROUP_WRITE_GUARD,
  insertRowsGuarded,
  isUniqueViolation,
  writeToGroupWithRetry,
} from './groupWrite.ts';
import { conflict, forbidden, invalidRequest, json, notFound, readJsonObject, unauthorized } from './http.ts';
import { MAX_MEMBERS_PER_GROUP } from './limits.ts';
import { parseUpdateMe } from './memberInput.ts';
import { countSeatedMembers, isGroupFull, pickMemberColor } from './membership.ts';
import { monthIn } from './months.ts';
import { BASIS_POINTS_TOTAL } from './settlement.ts';

const MAX_BODY_BYTES = 1024;

/**
 * 新しいグループに作る費目（screens.md 2章「グループ作成」）。アイコン・色は、アプリの一覧のキーと揃える仮の値
 * （アプリとはコードを共有しない。知らないキーは、アプリが既定の見た目で出す）。
 */
export const DEFAULT_CATEGORIES = [
  { name: '家賃', icon: 'home', color: 'blue' },
  { name: '食費', icon: 'cart', color: 'green' },
  { name: '日用品', icon: 'detergent', color: 'teal' },
  { name: '光熱費', icon: 'bulb', color: 'yellow' },
  { name: '外食', icon: 'utensils', color: 'orange' },
  { name: '通信費', icon: 'wifi', color: 'purple' },
  { name: 'その他', icon: 'more', color: 'gray' },
] as const;

// ---------------------------------------------------------------------------
// 読み取り

type MemberStatus = 'active' | 'leaving' | 'left' | 'deleted';

interface GroupRow {
  id: string;
  name: string;
  currency_code: string;
  currency_minor_unit: number;
  timezone: string;
  created_at: number;
}

interface MemberRow {
  id: string;
  user_id: string | null;
  display_name: string;
  color: string;
  status: MemberStatus;
  history_from_month: string;
  leave_requested_month: string | null;
  expense_end_month: string | null;
}

const groupJson = (row: GroupRow) => ({
  id: row.id,
  name: row.name,
  currencyCode: row.currency_code,
  currencyMinorUnit: row.currency_minor_unit,
  timezone: row.timezone,
  createdAt: row.created_at,
});

// `leaveEffective`: 脱退が確定したものとして扱うメンバーか（`isLeaveEffectiveFor`。招待の発行・参加と同じ判定）。`status` が
// `active` のままでも、脱退を選んだ月が終わっていれば true（翌月1日のCronが `status` を書くまでの間は、`status` だけでは
// 分からない）。`leaving`・`left`・`deleted` は、いつも true。アプリが、月の判定を書き写さずに、「脱退予定」の文言や招待の欄を
// 出し分けるため。
const memberJson = (row: MemberRow, userId: string, timezone: string, now: number) => ({
  id: row.id,
  displayName: row.display_name,
  color: row.color,
  status: row.status,
  historyFromMonth: row.history_from_month,
  leaveRequestedMonth: row.leave_requested_month,
  expenseEndMonth: row.expense_end_month,
  leaveEffective: isLeaveEffectiveFor({ status: row.status, leaveRequestedMonth: row.leave_requested_month }, timezone, now),
  isMe: row.user_id === userId,
});

// 通貨を変えられない理由になるものが、1つでもあるか。金額の整数は、通貨の最小単位なので、通貨を変えると、同じ整数が
// 別の金額になる。支出（2章の「支出が1件でも登録されたら」）に加えて、固定費のテンプレート・上限額つきの負担・
// 締めた月（通貨のスナップショットを持つ）も数える。`?1` はグループのID。
const CURRENCY_LOCKED_SQL = `SELECT (EXISTS (SELECT 1 FROM expenses WHERE group_id = ?1)
    OR EXISTS (SELECT 1 FROM recurring_expenses WHERE group_id = ?1)
    OR EXISTS (SELECT 1 FROM category_month_settings WHERE group_id = ?1 AND cap_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM monthly_closings WHERE group_id = ?1)) AS locked`;

async function isCurrencyLocked(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(CURRENCY_LOCKED_SQL).bind(groupId).first<{ locked: number }>();
  return row?.locked === 1;
}

/**
 * グループの情報。グループのデータを扱えるメンバー（`active`・`leaving`）でなければ null。
 * メンバーは、脱退済み・削除済みも含めて全員（名前は残す。5章）。ユーザーのIDは返さない。
 */
async function loadGroupDetail(db: D1Database, userId: string, groupId: string, now: number) {
  const [group, members, locked] = await db.batch([
    db
      .prepare('SELECT id, name, currency_code, currency_minor_unit, timezone, created_at FROM expense_groups WHERE id = ?')
      .bind(groupId),
    db
      .prepare(
        `SELECT id, user_id, display_name, color, status, history_from_month, leave_requested_month, expense_end_month
           FROM group_members WHERE group_id = ? ORDER BY id`,
      )
      .bind(groupId),
    db.prepare(CURRENCY_LOCKED_SQL).bind(groupId),
  ]);
  const groupRow = group.results[0] as GroupRow | undefined;
  if (groupRow === undefined) return null;
  const memberRows = members.results as unknown as MemberRow[];
  const me = memberRows.find((row) => row.user_id === userId && (row.status === 'active' || row.status === 'leaving'));
  if (me === undefined) return null;
  // 人数の上限(`MAX_MEMBERS_PER_GROUP`)で数える人数と、いま招待を発行できるか。アプリが、満員の判定を書き写さないように
  // 返す(脱退月が終わった直後の、Cronの確定の前は、メンバーの状態だけでは分からない)。招待の発行(invites.ts)と同じ判定。
  const seats = memberRows.map((row) => ({ status: row.status, leaveRequestedMonth: row.leave_requested_month }));
  const seatedMembers = countSeatedMembers(seats, groupRow.timezone, now);
  const meCanIssue = canIssueInvitesFor(
    { status: me.status, leaveRequestedMonth: me.leave_requested_month },
    groupRow.timezone,
    now,
  );
  return {
    ...groupJson(groupRow),
    memberId: me.id,
    seatedMembers,
    maxMembers: MAX_MEMBERS_PER_GROUP,
    // 未使用の招待の上限(`too_many_invites`)は含まない(自分の招待の一覧で分かる)。
    canInvite: meCanIssue && !isGroupFull(seats, groupRow.timezone, now),
    members: memberRows.map((row) => memberJson(row, userId, groupRow.timezone, now)),
    // 通貨を変えられないか（`PATCH` が 409 `currency_locked` を返す条件）。画面が、変更の入口を出すかを決めるため。
    currencyLocked: (locked.results[0] as { locked: number } | undefined)?.locked === 1,
  };
}

// ---------------------------------------------------------------------------
// POST /groups

export async function handleCreateGroup(request: Request, env: Env, now: number): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseCreateGroup(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const input = parsed.value;
  const db = env.DB;

  const groupId = input.id ?? crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const month = monthIn(input.timezone, now);
  const token = crypto.randomUUID();
  const categoryIds = DEFAULT_CATEGORIES.map(() => crypto.randomUUID());

  try {
    await db.batch([
      // 作った人が最初のメンバー。グループの行は、後続の文の条件（GROUP_WRITE_GUARD）のために token つきで作る。
      db
        .prepare(
          `INSERT INTO expense_groups (id, name, currency_code, currency_minor_unit, timezone, data_version, write_token, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(groupId, input.name, input.currencyCode, minorUnitOf(input.currencyCode)!, input.timezone, token, now),
      ...insertRowsGuarded(
        db,
        token,
        groupId,
        'group_members',
        ['id', 'group_id', 'user_id', 'display_name', 'color', 'status', 'history_from_month', 'joined_at'],
        [[memberId, groupId, session.userId, input.displayName, pickMemberColor([]), 'active', month, now]],
      ),
      ...insertRowsGuarded(
        db,
        token,
        groupId,
        'categories',
        ['id', 'group_id', 'name', 'icon', 'color', 'sort_order', 'created_at'],
        DEFAULT_CATEGORIES.map((category, index) => [
          categoryIds[index]!,
          groupId,
          category.name,
          category.icon,
          category.color,
          index,
          now,
        ]),
      ),
      // 作った月の割合は、作った人が100%（相手が参加した月に、均等にリセットされる。5章）。
      ...insertRowsGuarded(
        db,
        token,
        groupId,
        'category_month_settings',
        ['group_id', 'category_id', 'target_month', 'cap_member_id', 'cap_minor'],
        categoryIds.map((categoryId) => [groupId, categoryId, month, null, null]),
      ),
      ...insertRowsGuarded(
        db,
        token,
        groupId,
        'category_month_shares',
        ['group_id', 'category_id', 'target_month', 'member_id', 'share_basis_points'],
        categoryIds.map((categoryId) => [groupId, categoryId, month, memberId, BASIS_POINTS_TOTAL]),
      ),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // 同じ `id` の作成が先に済んでいる（再送、または同時の送信）。batch 全体が取り消されているので、何も書いていない。
    // 作った本人には、保存済みのグループを返す。他人のIDなら、中身を返さずに競合とする。
    const existing = await loadGroupDetail(db, session.userId, groupId, now);
    return existing === null ? conflict('conflict') : json({ group: existing }, 200);
  }
  const created = await loadGroupDetail(db, session.userId, groupId, now);
  if (created === null) throw new Error('作ったグループを読めない');
  return json({ group: created }, 201);
}

// ---------------------------------------------------------------------------
// GET /groups

export async function handleListGroups(request: Request, env: Env, now: number): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const { results } = await env.DB
    .prepare(
      `SELECT g.id AS id, g.name AS name, g.currency_code AS currency_code, g.currency_minor_unit AS currency_minor_unit,
              g.timezone AS timezone, g.created_at AS created_at,
              m.id AS member_id, m.status AS member_status, m.history_from_month AS history_from_month,
              m.leave_requested_month AS leave_requested_month, m.expense_end_month AS expense_end_month
         FROM group_members m JOIN expense_groups g ON g.id = m.group_id
        WHERE m.user_id = ?1 AND m.status IN ('active', 'leaving')
        ORDER BY g.created_at, g.id`,
    )
    .bind(session.userId)
    .all<
      GroupRow & {
        member_id: string;
        member_status: MemberStatus;
        history_from_month: string;
        leave_requested_month: string | null;
        expense_end_month: string | null;
      }
    >();
  return json({
    groups: results.map((row) => ({
      ...groupJson(row),
      memberId: row.member_id,
      memberStatus: row.member_status,
      historyFromMonth: row.history_from_month,
      leaveRequestedMonth: row.leave_requested_month,
      expenseEndMonth: row.expense_end_month,
    })),
  });
}

// ---------------------------------------------------------------------------
// GET /groups/:id

export async function handleGetGroup(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const detail = await loadGroupDetail(env.DB, session.userId, groupId, now);
  return detail === null ? notFound() : json({ group: detail });
}

// ---------------------------------------------------------------------------
// PATCH /groups/:id

export async function handleUpdateGroup(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseUpdateGroup(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const patch = parsed.value;
  const db = env.DB;

  const outcome = await writeToGroupWithRetry<null, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };
    // 通貨は、金額に関わるものが無いときだけ変えられる。いまと同じ通貨を送っても、変更ではない。
    const currencyChanges = patch.currencyCode !== undefined && patch.currencyCode !== access.group.currencyCode;
    if (currencyChanges && (await isCurrencyLocked(db, groupId))) return { reject: conflict('currency_locked') };
    // 変わるものが無ければ、書かずに、いまの状態を返す(バージョンを上げると、同時の他のメンバーの書き込みを、
    // 不要に競合させる)。
    const current = await db.prepare('SELECT name FROM expense_groups WHERE id = ?').bind(groupId).first<{ name: string }>();
    if (!currencyChanges && (patch.name === undefined || patch.name === current?.name)) {
      const detail = await loadGroupDetail(db, session.userId, groupId, now);
      return { reject: detail === null ? notFound() : json({ group: detail }) };
    }
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE expense_groups
                SET name = COALESCE(?, name), currency_code = COALESCE(?, currency_code),
                    currency_minor_unit = COALESCE(?, currency_minor_unit)
              WHERE id = ? AND write_token = ?`,
          )
          .bind(
            patch.name ?? null,
            currencyChanges ? patch.currencyCode! : null,
            currencyChanges ? minorUnitOf(patch.currencyCode!)! : null,
            groupId,
            token,
          ),
      ],
      value: null,
    };
  });
  switch (outcome.status) {
    case 'written': {
      const detail = await loadGroupDetail(db, session.userId, groupId, now);
      return detail === null ? notFound() : json({ group: detail });
    }
    case 'rejected':
      return outcome.reject;
    case 'no_group':
      return notFound();
    default:
      return conflict('conflict');
  }
}

// ---------------------------------------------------------------------------
// PATCH /groups/:id/members/me（自分の表示名と色）

export async function handleUpdateMe(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseUpdateMe(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const patch = parsed.value;
  const db = env.DB;

  const outcome = await writeToGroupWithRetry<null, Response>(db, groupId, async () => {
    // 名前と色は、脱退が確定したあとも直せる（集計や履歴に出るのは、締めた時点の名前。締めた月は変わらない）。
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    // 変わるものが無ければ、書かずに、いまの状態を返す(バージョンを上げない)。
    const current = await db
      .prepare('SELECT display_name, color FROM group_members WHERE id = ? AND group_id = ?')
      .bind(access.member.id, groupId)
      .first<{ display_name: string; color: string }>();
    if (
      (patch.displayName === undefined || patch.displayName === current?.display_name) &&
      (patch.color === undefined || patch.color === current?.color)
    ) {
      const detail = await loadGroupDetail(db, session.userId, groupId, now);
      return { reject: detail === null ? notFound() : json({ group: detail }) };
    }
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE group_members SET display_name = COALESCE(?, display_name), color = COALESCE(?, color)
              WHERE id = ? AND group_id = ? AND status IN ('active', 'leaving') AND EXISTS (${GROUP_WRITE_GUARD})`,
          )
          .bind(patch.displayName ?? null, patch.color ?? null, access.member.id, groupId, groupId, token),
      ],
      value: null,
    };
  });
  switch (outcome.status) {
    case 'written': {
      const detail = await loadGroupDetail(db, session.userId, groupId, now);
      return detail === null ? notFound() : json({ group: detail });
    }
    case 'rejected':
      return outcome.reject;
    case 'no_group':
      return notFound();
    default:
      return conflict('conflict');
  }
}
