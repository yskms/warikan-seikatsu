/// <reference types="node" />
// 招待の発行・一覧・取り消し・確認、参加のAPI（src/invites.ts）の検査。規則は docs/backend-design.md 5章、形は9章
// 「招待・参加・脱退」。ローカルD1（miniflare）での検査なので、確かめるのはロジック。競合は「読んだあとに別の書き込みが
// 入った」状況で再現して確かめている（本番D1での確認は13章の9）。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { deleteAccount } from '../src/accountDeletion.ts';
import worker from '../src/index.ts';
import { INVITE_TTL_MS, MAX_UNUSED_INVITES_PER_MEMBER } from '../src/invites.ts';
import { MAX_MEMBERS_PER_GROUP } from '../src/limits.ts';
import { MEMBER_COLORS, pickMemberColor } from '../src/membership.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertInviteRow,
  insertRecurringRow,
  NOW,
  type MemberOptions,
  type Person,
} from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { interferingEnv, NOW_DECEMBER, read, request } from './monthApi.ts';

describe('招待・参加のAPI', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let api: ReturnType<typeof membershipApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    api = membershipApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  // --- 準備の道具 -------------------------------------------------------------------------------

  /** alice・bob の2人（2026-10から参加中）と、費目1つ。2026-10の割合は均等。 */
  const setup = async (options: Partial<Record<'alice' | 'bob', MemberOptions>> = {}) => {
    const group = await factory.createGroup(['alice', 'bob'], options);
    await insertCategoryRule(
      db,
      group.groupId,
      group.categoryId,
      '2026-10',
      equalShares([group.people.alice.memberId, group.people.bob.memberId]),
    );
    return group;
  };
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  const memberRows = async (groupId: string) =>
    (
      await db
        .prepare(
          `SELECT id, user_id, display_name, color, status, history_from_month, leave_requested_month,
                  expense_end_month, joined_at, left_at FROM group_members WHERE group_id = ? ORDER BY id`,
        )
        .bind(groupId)
        .all<Record<string, unknown>>()
    ).results;
  const inviteRow = (inviteId: string) =>
    db
      .prepare('SELECT * FROM invites WHERE id = ?')
      .bind(inviteId)
      .first<{
        token_hash: string;
        consumed_at: number | null;
        consumed_by_member_id: string | null;
        revoked_at: number | null;
        expires_at: number;
      }>();
  const sharesOf = async (categoryId: string, month: string) =>
    (
      await db
        .prepare(
          `SELECT member_id, share_basis_points FROM category_month_shares
            WHERE category_id = ? AND target_month = ? ORDER BY member_id`,
        )
        .bind(categoryId, month)
        .all<{ member_id: string; share_basis_points: number }>()
    ).results.map((row) => [row.member_id, row.share_basis_points]);
  const settingsOf = (categoryId: string, month: string) =>
    db
      .prepare('SELECT cap_member_id, cap_minor FROM category_month_settings WHERE category_id = ? AND target_month = ?')
      .bind(categoryId, month)
      .first<{ cap_member_id: string | null; cap_minor: number | null }>();
  const markOf = (categoryId: string, month: string) =>
    db
      .prepare('SELECT member_changed_at, member_changed_kind FROM category_month_settings WHERE category_id = ? AND target_month = ?')
      .bind(categoryId, month)
      .first<{ member_changed_at: number | null; member_changed_kind: string | null }>();
  /** alice だけの1人のグループ（2026-10から）と、費目1つ。2026-10の割合は alice の100%。 */
  const setupSolo = async () => {
    const group = await factory.createGroup(['alice']);
    await insertCategoryRule(db, group.groupId, group.categoryId, '2026-10', equalShares([group.people.alice.memberId]));
    return group;
  };
  const pausedReason = async (recurringId: string) =>
    (
      await db
        .prepare('SELECT paused_reason FROM recurring_expenses WHERE id = ?')
        .bind(recurringId)
        .first<{ paused_reason: string | null }>()
    )!.paused_reason;
  const outsider = (name: string): Promise<Person> => factory.addUser(name);

  // === 発行 ===================================================================================

  describe('招待の発行（POST /groups/:id/invites）', () => {
    it('発行すると、期限は3日後で、トークンの平文は応答でだけ返す。D1にはハッシュだけを置く', async () => {
      const g = await setup();
      const before = await dataVersion(g.groupId);
      const result = await api.createInvite(g.people.alice, g.groupId);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const { id, token, expiresAt, createdAt } = result.body.invite;
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.deepEqual([expiresAt, createdAt], [NOW + INVITE_TTL_MS, NOW]);
      assert.equal(INVITE_TTL_MS, 3 * 24 * 60 * 60 * 1000);

      const row = await inviteRow(id);
      assert.equal(row!.token_hash, createHash('sha256').update(token).digest('base64url'));
      assert.notEqual(row!.token_hash, token);
      const { results } = await db.prepare('SELECT count(*) AS n FROM invites WHERE token_hash = ?').bind(token).all<{ n: number }>();
      assert.equal(results[0]!.n, 0, '平文は保存しない');
      assert.equal(await dataVersion(g.groupId), before + 1);
    });

    it('発行するたびに、別のトークンになる', async () => {
      const g = await setup();
      const a = await api.createInvite(g.people.alice, g.groupId);
      const b = await api.createInvite(g.people.alice, g.groupId);
      assert.notEqual(a.body.invite.token, b.body.invite.token);
      assert.notEqual(a.body.invite.id, b.body.invite.id);
    });

    it('脱退を選んだだけ（月が終わっていない）なら、発行できる。確定した（leaving）人・月が終わった人は、できない（403）', async () => {
      const g = await setup({ alice: { leaveRequestedMonth: '2026-11' } });
      assert.equal((await api.createInvite(g.people.alice, g.groupId)).status, 201);
      // 脱退月（2026-11）が終わったあと。Cronの確定を待たずに、確定したものとして扱う。
      assert.deepEqual(
        (await api.createInvite(g.people.alice, g.groupId, { now: NOW_DECEMBER })).status,
        403,
      );
      const h = await setup({ alice: { status: 'leaving', expenseEndMonth: '2026-11', leaveRequestedMonth: '2026-11' } });
      const result = await api.createInvite(h.people.alice, h.groupId);
      assert.deepEqual([result.status, result.body], [403, { error: 'forbidden' }]);
      assert.equal((await api.createInvite(h.people.bob, h.groupId)).status, 201, '残るメンバーは発行できる');
    });

    it('認証・所属: セッション無し401、メンバーでない人・脱退済み・他のグループは404。何も書かれない', async () => {
      const g = await setup();
      const other = await setup();
      const left = await factory.addPerson(g.groupId, 'erin', { status: 'left', expenseEndMonth: '2026-10' });
      const before = await dataVersion(g.groupId);
      assert.equal((await api.createInvite(null, g.groupId)).status, 401);
      for (const who of [await outsider('zed'), left, other.people.alice]) {
        const result = await api.createInvite(who, g.groupId);
        assert.deepEqual([result.status, result.body], [404, { error: 'not_found' }]);
      }
      assert.equal((await api.createInvite(g.people.alice, 'no-such-group')).status, 404);
      assert.equal(await dataVersion(g.groupId), before);
    });

    it(`未使用で期限内の招待は、1人 ${MAX_UNUSED_INVITES_PER_MEMBER} 件まで（409 too_many_invites）。期限切れ・取り消し済み・使用済みは数えない`, async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      // 数えないもの。
      await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, expiresAt: NOW - 1 });
      await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, revokedAt: NOW });
      await insertInviteRow(db, {
        groupId: g.groupId,
        invitedByMemberId: alice.memberId,
        consumed: { memberId: bob.memberId, at: NOW },
      });
      for (let i = 0; i < MAX_UNUSED_INVITES_PER_MEMBER; i++) {
        assert.equal((await api.createInvite(alice, g.groupId)).status, 201, `${i + 1}件目`);
      }
      const over = await api.createInvite(alice, g.groupId);
      assert.deepEqual([over.status, over.body], [409, { error: 'too_many_invites' }]);
      // 上限はメンバーごと。
      assert.equal((await api.createInvite(bob, g.groupId)).status, 201);
    });

    it(`人数の上限（${MAX_MEMBERS_PER_GROUP}人）: 参加中が上限なら、発行は409 group_full。脱退が確定した人は数えない`, async () => {
      const g = await setup();
      for (const name of ['carol', 'dave']) await factory.addPerson(g.groupId, name);
      const leaving = await factory.addPerson(g.groupId, 'erin', { status: 'leaving', leaveRequestedMonth: '2026-10', expenseEndMonth: '2026-10' });
      assert.equal((await api.createInvite(g.people.alice, g.groupId)).status, 201, '数えるのは4人');
      await db.prepare(`UPDATE group_members SET status = 'active', leave_requested_month = NULL, expense_end_month = NULL WHERE id = ?`).bind(leaving.memberId).run();
      const over = await api.createInvite(g.people.alice, g.groupId);
      assert.deepEqual([over.status, over.body], [409, { error: 'group_full' }]);
    });

    it('競合: 読んだあとに別の書き込みが入っても、1回だけやり直して成功する。続けて競合したら409', async () => {
      const g = await setup();
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(g.groupId).run();
      const once = await api.createInvite(g.people.alice, g.groupId, { env: interferingEnv(env, bump, { times: 1 }) });
      assert.equal(once.status, 201);
      const before = await dataVersion(g.groupId);
      const twice = await api.createInvite(g.people.alice, g.groupId, { env: interferingEnv(env, bump, { times: 2 }) });
      assert.deepEqual([twice.status, twice.body], [409, { error: 'conflict' }]);
      assert.equal(await dataVersion(g.groupId), before + 2, '増えたのは、割り込んだ2回分だけ');
    });
  });

  // === 一覧 ===================================================================================

  describe('招待の一覧（GET /groups/:id/invites）', () => {
    it('自分が発行した、未使用で期限内の招待だけを返す', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const mine = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });
      await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, expiresAt: NOW - 1 });
      await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, revokedAt: NOW });
      await insertInviteRow(db, {
        groupId: g.groupId,
        invitedByMemberId: alice.memberId,
        consumed: { memberId: bob.memberId, at: NOW },
      });
      await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: bob.memberId });

      const result = await api.listInvites(alice, g.groupId);
      assert.deepEqual(result.body, { invites: [{ id: mine.id, expiresAt: NOW + INVITE_TTL_MS, createdAt: NOW }] });
      assert.equal((await api.listInvites(null, g.groupId)).status, 401);
      assert.equal((await api.listInvites(await outsider('zed'), g.groupId)).status, 404);
    });
  });

  // === 取り消し ===============================================================================

  describe('招待の取り消し（DELETE /invites/:id）', () => {
    it('発行した人が取り消すと、204。取り消した招待では、確認も参加もできない', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const before = await dataVersion(g.groupId);
      const result = await api.revokeInvite(g.people.alice, invite.id);
      assert.deepEqual([result.status, result.body], [204, null]);
      assert.equal((await inviteRow(invite.id))!.revoked_at, NOW);
      assert.equal(await dataVersion(g.groupId), before + 1);

      const visitor = await outsider('visitor');
      assert.deepEqual((await api.getInvite(visitor, invite.token)).body, { error: 'invite_unavailable' });
      assert.equal((await api.join(visitor, invite.token)).status, 404);
    });

    it('発行した人以外・メンバーでない人・知らないID・他のグループは、無いものとして404', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      for (const who of [g.people.bob, await outsider('zed')]) {
        const result = await api.revokeInvite(who, invite.id);
        assert.deepEqual([result.status, result.body], [404, { error: 'not_found' }]);
      }
      assert.equal((await api.revokeInvite(g.people.alice, 'no-such-invite')).status, 404);
      assert.equal((await api.revokeInvite(null, invite.id)).status, 401);
      assert.equal((await inviteRow(invite.id))!.revoked_at, null);
    });

    it('使用済みの招待は取り消せない（409 invite_already_used）。取り消し済みは、そのまま204（時刻は変えない）', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const used = await insertInviteRow(db, {
        groupId: g.groupId,
        invitedByMemberId: alice.memberId,
        consumed: { memberId: bob.memberId, at: NOW },
      });
      const result = await api.revokeInvite(alice, used.id);
      assert.deepEqual([result.status, result.body], [409, { error: 'invite_already_used' }]);
      assert.equal((await inviteRow(used.id))!.revoked_at, null);

      const revoked = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, revokedAt: 777 });
      const before = await dataVersion(g.groupId);
      assert.equal((await api.revokeInvite(alice, revoked.id)).status, 204);
      assert.equal((await inviteRow(revoked.id))!.revoked_at, 777);
      assert.equal(await dataVersion(g.groupId), before, '何も書かないので、バージョンも上がらない');
    });
  });

  // === 確認 ===================================================================================

  describe('招待内容の確認（GET /invites/:token）', () => {
    it('グループ名と招待元を返す。URLを開いただけでは参加しない（メンバーも招待の状態も変わらない）', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const visitor = await outsider('visitor');
      const members = await memberRows(g.groupId);
      const before = await dataVersion(g.groupId);

      const result = await api.getInvite(visitor, invite.token);
      assert.deepEqual(result.body, {
        alreadyMember: false,
        groupName: 'ふたりの生活費',
        invitedByDisplayName: 'alice',
        expiresAt: NOW + INVITE_TTL_MS,
        groupFull: false,
      });
      assert.deepEqual(await memberRows(g.groupId), members);
      assert.deepEqual([(await inviteRow(invite.id))!.consumed_at, await dataVersion(g.groupId)], [null, before]);
    });

    it(`満員（${MAX_MEMBERS_PER_GROUP}人）なら groupFull: true。表示名を入力させる前に知らせる。脱退が確定した人は数えず、何も変わらない`, async () => {
      const g = await setup();
      for (const name of ['carol', 'dave']) await factory.addPerson(g.groupId, name);
      const erin = await factory.addPerson(g.groupId, 'erin');
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const visitor = await outsider('visitor');
      const before = await dataVersion(g.groupId);
      const full = await api.getInvite(visitor, invite.token);
      assert.deepEqual([full.status, full.body.alreadyMember, full.body.groupFull], [200, false, true]);
      // すでに参加中の人は、満員でも、グループを開くだけ（groupFull は付けない）。
      assert.deepEqual((await api.getInvite(g.people.bob, invite.token)).body, { alreadyMember: true, groupId: g.groupId });
      // 1人の脱退が確定すれば、空く。
      await db.prepare(`UPDATE group_members SET status = 'leaving', leave_requested_month = '2026-10', expense_end_month = '2026-10' WHERE id = ?`).bind(erin.memberId).run();
      assert.equal((await api.getInvite(visitor, invite.token)).body.groupFull, false);
      assert.equal(await dataVersion(g.groupId), before, '確認では何も書かない');
    });

    it('すでに参加中（脱退が確定した人を含む）なら、グループを開くための情報だけを返す。使用済みの招待でも同じ', async () => {
      const g = await setup();
      const carol = await factory.addPerson(g.groupId, 'carol', { status: 'leaving', expenseEndMonth: '2026-11' });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const used = await insertInviteRow(db, {
        groupId: g.groupId,
        invitedByMemberId: g.people.alice.memberId,
        consumed: { memberId: g.people.bob.memberId, at: NOW },
      });
      for (const who of [g.people.bob, carol]) {
        assert.deepEqual((await api.getInvite(who, invite.token)).body, { alreadyMember: true, groupId: g.groupId });
      }
      assert.deepEqual((await api.getInvite(g.people.bob, used.token)).body, { alreadyMember: true, groupId: g.groupId });
    });

    it('使えない招待は、理由を区別せず404 invite_unavailable（知らないトークン・期限切れ・取り消し済み・使用済み・発行者が抜けた）', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const gone = await factory.addPerson(g.groupId, 'gone', { status: 'left', expenseEndMonth: '2026-10' });
      const leaving = await factory.addPerson(g.groupId, 'leaving', { status: 'leaving', expenseEndMonth: '2026-11' });
      const stale = await factory.addPerson(g.groupId, 'stale', { leaveRequestedMonth: '2026-10' });
      const tokens = [
        'x'.repeat(43), // 知らないトークン
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, expiresAt: NOW })).token,
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, revokedAt: NOW })).token,
        (
          await insertInviteRow(db, {
            groupId: g.groupId,
            invitedByMemberId: alice.memberId,
            consumed: { memberId: bob.memberId, at: NOW },
          })
        ).token,
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: gone.memberId })).token,
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: leaving.memberId })).token,
        // 脱退月（2026-10）が終わっているのに、Cronがまだ確定させていない人の招待。
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: stale.memberId })).token,
      ];
      const visitor = await outsider('visitor');
      for (const token of tokens) {
        const result = await api.getInvite(visitor, token);
        assert.deepEqual([result.status, result.body], [404, { error: 'invite_unavailable' }], token);
      }
      assert.equal((await api.getInvite(null, tokens[0]!)).status, 401);
    });

    it('発行者が、脱退を選んだだけ（月が終わっていない）なら、招待は使える', async () => {
      const g = await setup({ alice: { leaveRequestedMonth: '2026-11' } });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      assert.equal((await api.getInvite(await outsider('visitor'), invite.token)).status, 200);
    });

    it('招待トークンの形でないパスは、JSONの404（ルーティング）', async () => {
      const response = await worker.fetch(request('GET', '/invites/short', 'x'.repeat(43)), env);
      assert.deepEqual(await read(response), { status: 404, body: { error: 'not_found' } });
    });
  });

  // === 参加 ===================================================================================

  describe('参加（POST /invites/:token/join）', () => {
    it('参加すると、メンバーに加わり、履歴は参加月から。招待は使用済みになり、バージョンが上がる', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const visitor = await outsider('visitor');
      const before = await dataVersion(g.groupId);

      const result = await api.join(visitor, invite.token, { displayName: '  みっちゃん  ' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.groupId, g.groupId);
      const memberId = result.body.memberId as string;

      const rows = await memberRows(g.groupId);
      const added = rows.find((row) => row.id === memberId)!;
      assert.deepEqual(
        [added.user_id, added.display_name, added.status, added.history_from_month, added.joined_at, added.leave_requested_month],
        [visitor.userId, 'みっちゃん', 'active', '2026-11', NOW, null],
      );
      // 色は、他の参加中のメンバーと重ならない（テストの準備では、全員 'pink'）。
      assert.notEqual(added.color, 'pink');
      assert.deepEqual(
        [(await inviteRow(invite.id))!.consumed_at, (await inviteRow(invite.id))!.consumed_by_member_id],
        [NOW, memberId],
      );
      assert.equal(await dataVersion(g.groupId), before + 1);

      // 参加したので、確認は「参加中」を返し、同じ招待で、もう一度は参加できない。
      assert.deepEqual((await api.getInvite(visitor, invite.token)).body, { alreadyMember: true, groupId: g.groupId });
      const again = await api.join(visitor, invite.token);
      assert.deepEqual([again.status, again.body], [409, { error: 'already_member', groupId: g.groupId }]);
    });

    it('2人以上のグループへの参加: 全費目（アーカイブ済みも）の今の割合と上限額を残し、新しいメンバーを0%で足す。ほかの月は変えない', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const archivedId = await factory.addCategory(g.groupId, 'old', true);
      await insertCategoryRule(db, g.groupId, archivedId, '2026-10', equalShares([alice.memberId, bob.memberId]));
      await insertCategoryRule(
        db,
        g.groupId,
        g.categoryId,
        '2026-11',
        [
          [alice.memberId, 8000],
          [bob.memberId, 2000],
        ],
        { memberId: alice.memberId, capMinor: 3000 },
      );
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });

      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201);
      const newcomer = result.body.memberId as string;
      const sorted = (rows: (string | number)[][]) => rows.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
      // 手で直した割合・上限額は、そのまま。新しいメンバーが0%で入る。
      assert.deepEqual(
        await sharesOf(g.categoryId, '2026-11'),
        sorted([[alice.memberId, 8000], [bob.memberId, 2000], [newcomer, 0]]),
      );
      assert.deepEqual(await settingsOf(g.categoryId, '2026-11'), { cap_member_id: alice.memberId, cap_minor: 3000 });
      // 参加月に行が無かった費目（10月の行を引き継いでいた）も、引き継いでいた割合を、参加月の行として書く。
      assert.deepEqual(
        await sharesOf(archivedId, '2026-11'),
        sorted([[alice.memberId, 5000], [bob.memberId, 5000], [newcomer, 0]]),
      );
      assert.deepEqual(await settingsOf(archivedId, '2026-11'), { cap_member_id: null, cap_minor: null });
      // 見直しの印は「0%で足した」（joined）。
      for (const categoryId of [g.categoryId, archivedId]) {
        assert.deepEqual(await markOf(categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'joined' });
      }
      // 参加月より前の月の割合・印は、そのまま。
      assert.equal((await sharesOf(g.categoryId, '2026-10')).length, 2);
      assert.deepEqual(await markOf(g.categoryId, '2026-10'), { member_changed_at: null, member_changed_kind: null });
    });

    it('1人のグループへの参加: 今までどおり、均等にリセットする（上限額を外し、印は reset）。手で直した割合がまだ無いため', async () => {
      const g = await setupSolo();
      const { alice } = g.people;
      // 1人でも、上限額つきの設定は書ける（参加で外れる）。
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', [[alice.memberId, 10000]], { memberId: alice.memberId, capMinor: 5000 });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });

      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201);
      assert.deepEqual(
        (await sharesOf(g.categoryId, '2026-11')).map((row) => row[1]),
        [5000, 5000],
      );
      assert.deepEqual(await settingsOf(g.categoryId, '2026-11'), { cap_member_id: null, cap_minor: null });
      assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'reset' });
    });

    it('参加月より後の月に、割合の行が残っていれば、それも直す（アカウント削除が、未締めの翌月に書いた行に、参加した人が入る）', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      await deleteAccount(db, alice.userId, NOW); // 2026-12 の行が、残る bob だけで書かれる
      assert.deepEqual(await sharesOf(g.categoryId, '2026-12'), [[bob.memberId, 10000]]);
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: bob.memberId });

      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201);
      const newcomer = result.body.memberId as string;
      // 参加月（2026-11）は、削除した alice（削除した月まで集計に入る）・bob の2人が参加前にいたので、今の割合を残して、新しいメンバーを0%で足す。
      assert.deepEqual(
        (await sharesOf(g.categoryId, '2026-11')).map((row) => row[1]).sort(),
        [0, 5000, 5000],
      );
      assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'joined' });
      // 翌月（2026-12）は、参加前に bob だけだったので、alice が抜けたあとの、bob と新しいメンバーの2人の均等。
      assert.deepEqual(
        (await sharesOf(g.categoryId, '2026-12')).map((row) => row[0]).sort(),
        [bob.memberId, newcomer].sort(),
      );
      assert.deepEqual((await sharesOf(g.categoryId, '2026-12')).map((row) => row[1]), [5000, 5000]);
      assert.deepEqual(await markOf(g.categoryId, '2026-12'), { member_changed_at: NOW, member_changed_kind: 'reset' });
    });

    describe('今の割合を残せない費目は、その費目だけ均等にリセットする（安全側の経路。withNewMemberAtZero）', () => {
      /** erin（脱退済み）を含むグループ。参加前にその月にいるのは alice・bob の2人（erin は復帰する本人なので、数えない）。 */
      const withLeftErin = async () => {
        const g = await setup();
        const erin = await factory.addPerson(g.groupId, 'erin', { status: 'left', expenseEndMonth: '2026-10', leaveRequestedMonth: '2026-10' });
        await db.prepare('UPDATE group_members SET left_at = 5 WHERE id = ?').bind(erin.memberId).run();
        const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
        return { g, erin, invite };
      };

      it('復帰する人の古い行が残っていて、それを除くと合計が10000にならないとき', async () => {
        const { g, erin, invite } = await withLeftErin();
        const { alice, bob } = g.people;
        // 参加月の行に、復帰する erin の古い割合が残っている（本来は起こらない）。erin を除くと 8000。
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', [[alice.memberId, 4000], [bob.memberId, 4000], [erin.memberId, 2000]]);

        assert.equal((await api.join(erin, invite.token, { displayName: 'えりん' })).status, 201);
        // その費目だけ、参加後の3人での均等に戻る。印は reset。
        assert.deepEqual((await sharesOf(g.categoryId, '2026-11')).map((row) => row[1]).sort(), [3333, 3333, 3334]);
        assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'reset' });
      });

      it('上限を負担する人が、参加する本人のとき（上限額も外れる）', async () => {
        const { g, erin, invite } = await withLeftErin();
        const { alice, bob } = g.people;
        await insertCategoryRule(
          db,
          g.groupId,
          g.categoryId,
          '2026-11',
          [[alice.memberId, 5000], [bob.memberId, 5000], [erin.memberId, 0]],
          { memberId: erin.memberId, capMinor: 3000 },
        );

        assert.equal((await api.join(erin, invite.token, { displayName: 'えりん' })).status, 201);
        assert.deepEqual((await sharesOf(g.categoryId, '2026-11')).map((row) => row[1]).sort(), [3333, 3333, 3334]);
        assert.deepEqual(await settingsOf(g.categoryId, '2026-11'), { cap_member_id: null, cap_minor: null });
        assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'reset' });
      });

      it('崩れていない費目は、同じ参加の中で、今の割合を残す（費目ごとに決まる）', async () => {
        const { g, erin, invite } = await withLeftErin();
        const { alice, bob } = g.people;
        const healthyId = await factory.addCategory(g.groupId, 'rent');
        await insertCategoryRule(db, g.groupId, healthyId, '2026-10', [[alice.memberId, 7000], [bob.memberId, 3000]]);
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', [[alice.memberId, 4000], [bob.memberId, 4000], [erin.memberId, 2000]]);

        assert.equal((await api.join(erin, invite.token, { displayName: 'えりん' })).status, 201);
        assert.deepEqual(
          (await sharesOf(healthyId, '2026-11')).map((row) => row[1]).sort((a, b) => Number(a) - Number(b)),
          [0, 3000, 7000],
        );
        assert.deepEqual(await markOf(healthyId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'joined' });
        assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'reset' });
      });
    });

    it('同じ参加の中で、参加月は割合を残し、後の月は均等にリセットする（もう1人がその月で脱退するとき）。固定費は、リセットした月があるので止める', async () => {
      // bob は、参加月（2026-11）で脱退する。翌月（2026-12）の行は、残る alice だけ（脱退の確定が書く形）。
      const g = await setup({ bob: { leaveRequestedMonth: '2026-11' } });
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-12', [[alice.memberId, 10000]]);
      const recurring = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: alice.memberId, splitMethod: 'equal' });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });

      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const newcomer = result.body.memberId as string;
      // 2026-11: 参加前に alice・bob（脱退する月だが、まだ集計に入る）の2人 → 今の割合を残して0%で足す。
      assert.deepEqual(
        await sharesOf(g.categoryId, '2026-11'),
        [[alice.memberId, 5000], [bob.memberId, 5000], [newcomer, 0]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
      );
      assert.deepEqual(await markOf(g.categoryId, '2026-11'), { member_changed_at: NOW, member_changed_kind: 'joined' });
      // 2026-12: 参加前に alice だけ → 均等（alice と新しいメンバー）。
      assert.deepEqual((await sharesOf(g.categoryId, '2026-12')).map((row) => row[1]), [5000, 5000]);
      assert.deepEqual(await markOf(g.categoryId, '2026-12'), { member_changed_at: NOW, member_changed_kind: 'reset' });
      assert.equal(await pausedReason(recurring), 'member_changed');
    });

    it('2人以上のグループへの参加では、固定費を止めない（個別の負担は、そのまま成り立つ）', async () => {
      const g = await setup();
      const { alice } = g.people;
      const equal = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: alice.memberId, splitMethod: 'equal' });
      const fixed = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: alice.memberId, splitMethod: 'fixed' });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });
      assert.equal((await api.join(await outsider('visitor'), invite.token)).status, 201);
      assert.deepEqual([await pausedReason(equal), await pausedReason(fixed)], [null, null]);
    });

    it('1人のグループへの参加では、category 以外の固定費は止める（member_changed）。category の固定費・止まっている固定費は変えない', async () => {
      const g = await setupSolo();
      const { alice } = g.people;
      const equal = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: alice.memberId, splitMethod: 'equal' });
      const category = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: alice.memberId });
      const manual = await insertRecurringRow(db, {
        groupId: g.groupId,
        categoryId: g.categoryId,
        payerMemberId: alice.memberId,
        splitMethod: 'fixed',
        pausedReason: 'manual',
      });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });
      assert.equal((await api.join(await outsider('visitor'), invite.token)).status, 201);
      assert.deepEqual(
        [await pausedReason(equal), await pausedReason(category), await pausedReason(manual)],
        ['member_changed', null, 'manual'],
      );
    });

    it('参加月がすでに締められているとき（早めに締めた後）は、締めた月の割合には触れず、翌月をリセットする', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', equalShares([alice.memberId, bob.memberId]));
      await insertClosing(db, g.groupId, '2026-11', alice.memberId);
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId });

      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201);
      assert.equal((await sharesOf(g.categoryId, '2026-11')).length, 2, '締めた月は、そのまま');
      // 翌月は、締めた月の行（2人の均等）を引き継いでいたので、その割合を残して、新しいメンバーを0%で足す。
      assert.deepEqual(
        (await sharesOf(g.categoryId, '2026-12')).map((row) => row[1]).sort(),
        [0, 5000, 5000],
      );
      assert.deepEqual(await markOf(g.categoryId, '2026-12'), { member_changed_at: NOW, member_changed_kind: 'joined' });
      const added = (await memberRows(g.groupId)).find((row) => row.id === result.body.memberId)!;
      assert.equal(added.history_from_month, '2026-11', '履歴は参加月（締めた月）から');
    });

    it('一度脱退した人（left）は、元のメンバー行に戻る。履歴は復帰した月から、脱退の記録は消える', async () => {
      const g = await setup();
      const erin = await factory.addPerson(g.groupId, 'erin', { status: 'left', expenseEndMonth: '2026-10', leaveRequestedMonth: '2026-10' });
      await db.prepare('UPDATE group_members SET left_at = 5, color = ? WHERE id = ?').bind('blue', erin.memberId).run();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const membersBefore = (await memberRows(g.groupId)).length;

      const result = await api.join(erin, invite.token, { displayName: 'えりん' });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.memberId, erin.memberId);
      const rows = await memberRows(g.groupId);
      assert.equal(rows.length, membersBefore, '行は増えない');
      const row = rows.find((r) => r.id === erin.memberId)!;
      assert.deepEqual(
        [row.status, row.display_name, row.history_from_month, row.leave_requested_month, row.expense_end_month, row.left_at, row.joined_at],
        ['active', 'えりん', '2026-11', null, null, null, NOW],
      );
      assert.equal(row.color, 'blue', '他のメンバーと重ならなければ、元の色のまま');
      assert.deepEqual(
        (await sharesOf(g.categoryId, '2026-11')).find((row) => row[0] === erin.memberId),
        [erin.memberId, 0],
        '復帰した人は、0%で入る（参加前に2人いた）',
      );
      assert.equal((await sharesOf(g.categoryId, '2026-11')).length, 3);
    });

    it('すでに参加中なら409 already_member。招待は使われない', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const before = await dataVersion(g.groupId);
      const result = await api.join(g.people.bob, invite.token);
      assert.deepEqual([result.status, result.body], [409, { error: 'already_member', groupId: g.groupId }]);
      assert.equal((await inviteRow(invite.id))!.consumed_at, null);
      assert.equal(await dataVersion(g.groupId), before);
    });

    it('使えない招待（期限切れ・取り消し済み・使用済み・知らないトークン・発行者が抜けた）には参加できない（404 invite_unavailable）。何も書かれない', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const gone = await factory.addPerson(g.groupId, 'gone', { status: 'left', expenseEndMonth: '2026-10' });
      const tokens = [
        'x'.repeat(43),
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, expiresAt: NOW })).token,
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: alice.memberId, revokedAt: NOW })).token,
        (
          await insertInviteRow(db, {
            groupId: g.groupId,
            invitedByMemberId: alice.memberId,
            consumed: { memberId: bob.memberId, at: NOW },
          })
        ).token,
        (await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: gone.memberId })).token,
      ];
      const before = await dataVersion(g.groupId);
      const members = await memberRows(g.groupId);
      for (const token of tokens) {
        const result = await api.join(await outsider('visitor'), token);
        assert.deepEqual([result.status, result.body], [404, { error: 'invite_unavailable' }], token);
      }
      assert.equal(await dataVersion(g.groupId), before);
      assert.deepEqual(await memberRows(g.groupId), members);
    });

    it('表示名の検査（400 invalid_request）: 必須・前後の空白を落として1〜20文字（コードポイント）・知らない項目は断る', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const visitor = await outsider('visitor');
      const bad: [unknown, string | undefined][] = [
        [{}, 'displayName'],
        [{ displayName: 5 }, 'displayName'],
        [{ displayName: '   ' }, 'displayName'],
        [{ displayName: 'あ'.repeat(21) }, 'displayName'],
        [{ displayName: '😀'.repeat(21) }, 'displayName'],
        [{ displayName: 'ok', color: 'red' }, 'color'],
        [[], undefined],
      ];
      for (const [body, field] of bad) {
        const result = await api.join(visitor, invite.token, body);
        assert.deepEqual([result.status, result.body], [400, field === undefined ? { error: 'invalid_request' } : { error: 'invalid_request', field }]);
      }
      const notJson = await read(
        await worker.fetch(
          new Request(`https://example.test/invites/${invite.token}/join`, {
            method: 'POST',
            headers: { authorization: `Bearer ${visitor.token}` },
            body: '{',
          }),
          env,
        ),
      );
      assert.deepEqual(notJson, { status: 400, body: { error: 'invalid_request' } });
      assert.equal((await inviteRow(invite.id))!.consumed_at, null);
      // ちょうど20文字（絵文字を含む）は通る。
      assert.equal((await api.join(visitor, invite.token, { displayName: '😀'.repeat(20) })).status, 201);
    });

    it('認証: セッション無しは401', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      assert.equal((await api.join(null, invite.token)).status, 401);
    });

    it('同じ招待で同時に参加しようとすると、片方だけが参加し、もう片方は409 conflict（何も書かれない）', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const first = await outsider('first');
      const second = await outsider('second');
      // second が検証を終えたあと、書き込みの直前に、first が参加する。
      const racing = interferingEnv(env, async () => {
        assert.equal((await api.join(first, invite.token, { displayName: 'first' })).status, 201);
      });
      const result = await api.join(second, invite.token, { displayName: 'second' }, { env: racing });
      assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);

      const rows = await memberRows(g.groupId);
      assert.deepEqual(rows.map((row) => row.user_id).filter((id) => id === first.userId || id === second.userId), [first.userId]);
      assert.equal((await inviteRow(invite.id))!.consumed_by_member_id, rows.find((row) => row.user_id === first.userId)!.id);
      // 負けた側が読み直すと、使えない招待として断られる。
      assert.deepEqual((await api.join(second, invite.token)).body, { error: 'invite_unavailable' });
    });

    it('同じ人の二重送信（同時）でも、メンバー行は1つだけ', async () => {
      const g = await setup();
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const visitor = await outsider('visitor');
      const racing = interferingEnv(env, async () => {
        assert.equal((await api.join(visitor, invite.token, { displayName: 'one' })).status, 201);
      });
      const result = await api.join(visitor, invite.token, { displayName: 'two' }, { env: racing });
      assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);
      assert.equal((await memberRows(g.groupId)).filter((row) => row.user_id === visitor.userId).length, 1);
    });

    it('色: 他の参加中のメンバーと重ならない最初の色を選ぶ', async () => {
      const g = await setup();
      // 参加中4人（上限の1つ手前）で、pink・red・orange を使っている。脱退済みの人の色は、空いているものとして扱う。
      const carol = await factory.addPerson(g.groupId, 'carol');
      const dave = await factory.addPerson(g.groupId, 'dave');
      const gone = await factory.addPerson(g.groupId, 'gone', { status: 'left', leaveRequestedMonth: '2026-10', expenseEndMonth: '2026-10' });
      const colorOf = async (memberId: string, color: string) =>
        db.prepare('UPDATE group_members SET color = ? WHERE id = ?').bind(color, memberId).run();
      await colorOf(g.people.alice.memberId, 'pink');
      await colorOf(g.people.bob.memberId, 'red');
      await colorOf(carol.memberId, 'orange');
      await colorOf(dave.memberId, 'pink');
      await colorOf(gone.memberId, 'yellow');
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const result = await api.join(await outsider('visitor'), invite.token);
      assert.equal(result.status, 201);
      const added = (await memberRows(g.groupId)).find((row) => row.id === result.body.memberId)!;
      assert.equal(added.color, 'yellow');
    });

    it('色: 全色が使われていれば、使われている数で一巡する（人数の上限の下では起きないが、関数としての規則）', () => {
      assert.equal(pickMemberColor([...MEMBER_COLORS, 'pink', 'red'], null), MEMBER_COLORS[2]);
      assert.equal(pickMemberColor(['pink'], 'teal'), 'teal', '前の色が空いていれば、それを使う');
    });

    it(`人数の上限（${MAX_MEMBERS_PER_GROUP}人）: 参加中が上限なら、参加は409 group_full。何も書かれない`, async () => {
      const g = await setup();
      for (const name of ['carol', 'dave', 'erin']) await factory.addPerson(g.groupId, name);
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const before = await dataVersion(g.groupId);
      const result = await api.join(await outsider('visitor'), invite.token);
      assert.deepEqual([result.status, result.body], [409, { error: 'group_full' }]);
      assert.equal(await dataVersion(g.groupId), before);
      assert.equal((await inviteRow(invite.id))!.consumed_at, null, '招待は使われない');
    });

    it('人数の上限: 脱退が確定した人・脱退月が終わった人・脱退済み・削除済みは数えない。脱退を選んだだけ（今月で抜ける）の人は数える', async () => {
      const g = await setup();
      await factory.addPerson(g.groupId, 'carol', { status: 'leaving', leaveRequestedMonth: '2026-10', expenseEndMonth: '2026-10' });
      await factory.addPerson(g.groupId, 'dave', { leaveRequestedMonth: '2026-10' }); // 脱退月が終わった（Cronの確定の前）
      await factory.addPerson(g.groupId, 'left1', { status: 'left', leaveRequestedMonth: '2026-10', expenseEndMonth: '2026-10' });
      await factory.addMember(g.groupId, 'deleted1', null, { status: 'deleted' });
      await factory.addPerson(g.groupId, 'erin');
      await factory.addPerson(g.groupId, 'frank', { leaveRequestedMonth: '2026-11' }); // 今月で抜ける。今月はいる
      // 数えるのは alice・bob・erin・frank の4人。あと1人は参加できる。
      const first = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      assert.equal((await api.join(await outsider('visitor1'), first.token)).status, 201);
      const second = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      assert.equal((await api.join(await outsider('visitor2'), second.token)).status, 409);
    });

    it('人数の上限: 脱退した人（left）の復帰も、上限を超えるなら断る', async () => {
      const g = await setup();
      for (const name of ['carol', 'dave', 'erin']) await factory.addPerson(g.groupId, name);
      const back = await factory.addPerson(g.groupId, 'back', { status: 'left', leaveRequestedMonth: '2026-10', expenseEndMonth: '2026-10' });
      const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
      const result = await api.join(back, invite.token);
      assert.deepEqual([result.status, result.body], [409, { error: 'group_full' }]);
      assert.equal((await memberRows(g.groupId)).find((row) => row.id === back.memberId)!.status, 'left');
    });
  });
});
