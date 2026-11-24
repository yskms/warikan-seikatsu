/// <reference types="node" />
// 脱退を選ぶ・取り消すAPI（src/leave.ts）の検査。規則は docs/backend-design.md 5章「脱退」、形は9章「招待・参加・脱退」。
// 脱退の確定の中身（月締め・Cron）は leaveConfirmation.test.ts・cron.test.ts。ローカルD1での検査なので、
// 確かめるのはロジック。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertExpenseRow,
  insertInviteRow,
  NOW,
  type MemberOptions,
  type Person,
} from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { interferingEnv, monthApi, NOW_DECEMBER } from './monthApi.ts';

describe('脱退を選ぶ・取り消すAPI', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let api: ReturnType<typeof membershipApi>;
  let months: ReturnType<typeof monthApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    api = membershipApi(env);
    months = monthApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  const setup = async <Name extends string>(
    names: readonly Name[],
    options: Partial<Record<Name, MemberOptions>> = {},
  ) => {
    const group = await factory.createGroup(names, options);
    await insertCategoryRule(db, group.groupId, group.categoryId, '2026-10', equalShares(names.map((name) => group.people[name].memberId)));
    return group;
  };
  const memberRow = (memberId: string) =>
    db
      .prepare('SELECT status, leave_requested_month, expense_end_month, left_at FROM group_members WHERE id = ?')
      .bind(memberId)
      .first<{ status: string; leave_requested_month: string | null; expense_end_month: string | null; left_at: number | null }>();
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  const groupCount = async (groupId: string) =>
    (await db.prepare('SELECT count(*) AS n FROM expense_groups WHERE id = ?').bind(groupId).first<{ n: number }>())!.n;
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

  describe('「今月で脱退する」（POST /groups/:id/leave）', () => {
    it('脱退月に、グループのタイムゾーンの今月が入る。確定はしない（status は active のまま）', async () => {
      const g = await setup(['alice', 'bob']);
      const before = await dataVersion(g.groupId);
      const result = await api.requestLeave(g.people.alice, g.groupId);
      assert.deepEqual([result.status, result.body], [200, { leaveRequestedMonth: '2026-11', confirmed: false }]);
      assert.deepEqual(await memberRow(g.people.alice.memberId), {
        status: 'active',
        leave_requested_month: '2026-11',
        expense_end_month: null,
        left_at: null,
      });
      assert.equal(await dataVersion(g.groupId), before + 1);
      // 月は、UTCではなくグループのタイムゾーン（Asia/Tokyo）で決める。UTCの 2026-11-30 15:30 は、JSTでは12月。
      const h = await setup(['alice', 'bob']);
      const dec = await api.requestLeave(h.people.alice, h.groupId, { now: Date.UTC(2026, 10, 30, 15, 30, 0) });
      assert.equal(dec.body.leaveRequestedMonth, '2026-12');
    });

    it('選んだあとも、脱退月の間は招待を発行できる。脱退月が終わると、Cronの確定を待たずに、確定したものとして扱う', async () => {
      const g = await setup(['alice', 'bob']);
      await api.requestLeave(g.people.alice, g.groupId);
      assert.equal((await api.createInvite(g.people.alice, g.groupId)).status, 201);
      assert.equal((await api.createInvite(g.people.alice, g.groupId, { now: NOW_DECEMBER })).status, 403);
    });

    it('すでに選んでいれば409 leave_already_requested。確定した（leaving）人・脱退月が終わった人は409 leave_confirmed', async () => {
      const g = await setup(['alice', 'bob', 'carol', 'dave'], {
        carol: { status: 'leaving', expenseEndMonth: '2026-11', leaveRequestedMonth: '2026-11' },
        dave: { leaveRequestedMonth: '2026-11' },
      });
      assert.equal((await api.requestLeave(g.people.alice, g.groupId)).status, 200);
      const again = await api.requestLeave(g.people.alice, g.groupId);
      assert.deepEqual([again.status, again.body], [409, { error: 'leave_already_requested' }]);
      assert.deepEqual((await api.requestLeave(g.people.carol, g.groupId)).body, { error: 'leave_confirmed' });
      // dave は11月に脱退を選んだが、12月になり、Cronが確定させる前。
      assert.deepEqual((await api.requestLeave(g.people.dave, g.groupId, { now: NOW_DECEMBER })).body, {
        error: 'leave_confirmed',
      });
    });

    it('認証・所属: セッション無し401、メンバーでない人・脱退済み・他のグループは404。何も書かれない', async () => {
      const g = await setup(['alice', 'bob']);
      const other = await setup(['zed']);
      const left = await factory.addPerson(g.groupId, 'erin', { status: 'left', expenseEndMonth: '2026-10' });
      const before = await dataVersion(g.groupId);
      assert.equal((await api.requestLeave(null, g.groupId)).status, 401);
      for (const who of [await factory.addUser('visitor'), left, other.people.zed]) {
        const result = await api.requestLeave(who, g.groupId);
        assert.deepEqual([result.status, result.body], [404, { error: 'not_found' }]);
      }
      assert.equal((await api.requestLeave(g.people.alice, 'no-such-group')).status, 404);
      assert.equal(await dataVersion(g.groupId), before);
    });

    it('競合: 読んだあとに別の書き込みが入ったら、やり直さずに409 conflict。何も書かれない', async () => {
      const g = await setup(['alice', 'bob']);
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(g.groupId).run();
      const result = await api.requestLeave(g.people.alice, g.groupId, { env: interferingEnv(env, bump) });
      assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);
      assert.equal((await memberRow(g.people.alice.memberId))!.leave_requested_month, null);
      // 読み直してやり直せば、成功する。
      assert.equal((await api.requestLeave(g.people.alice, g.groupId)).status, 200);
    });

    describe('脱退月がすでに締められているとき（早めに締めた後）は、その場で確定する', () => {
      /** 11月に alice が6,000円払って、11月を締める。送金は bob → alice の3,000円。 */
      const closedNovember = async () => {
        const g = await setup(['alice', 'bob']);
        await insertExpenseRow(db, {
          groupId: g.groupId,
          categoryId: g.categoryId,
          payerMemberId: g.people.alice.memberId,
          amountMinor: 6000,
          targetMonth: '2026-11',
        });
        const closed = await months.close(g.people.alice, g.groupId, '2026-11');
        assert.equal(closed.status, 201, JSON.stringify(closed.body));
        return { g, transfer: closed.body.transfers[0] as { id: string } };
      };

      it('関わる送金が残っていれば、脱退が確定した（leaving）まま。翌月の割合のリセット・招待の取り消しも行う', async () => {
        const { g } = await closedNovember();
        const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
        const result = await api.requestLeave(g.people.alice, g.groupId);
        assert.deepEqual([result.status, result.body], [200, { leaveRequestedMonth: '2026-11', confirmed: true }]);
        assert.deepEqual(await memberRow(g.people.alice.memberId), {
          status: 'leaving',
          leave_requested_month: '2026-11',
          expense_end_month: '2026-11',
          left_at: null,
        });
        assert.deepEqual(await sharesOf(g.categoryId, '2026-12'), [[g.people.bob.memberId, 10000]]);
        assert.notEqual(
          (await db.prepare('SELECT revoked_at FROM invites WHERE id = ?').bind(invite.id).first<{ revoked_at: number | null }>())!
            .revoked_at,
          null,
        );
        // 確定したので、取り消せない。
        assert.deepEqual((await api.cancelLeave(g.people.alice, g.groupId)).body, { error: 'leave_confirmed' });
      });

      it('精算が済めば、脱退済みになる', async () => {
        const { g, transfer } = await closedNovember();
        await api.requestLeave(g.people.alice, g.groupId);
        assert.equal((await months.settle(g.people.bob, transfer.id)).status, 200);
        assert.equal((await memberRow(g.people.alice.memberId))!.status, 'left');
      });

      it('関わる送金が0件なら、その場で脱退済みになる', async () => {
        const g = await setup(['alice', 'bob']);
        await insertClosing(db, g.groupId, '2026-11', g.people.bob.memberId);
        const result = await api.requestLeave(g.people.alice, g.groupId);
        assert.equal(result.body.confirmed, true);
        const row = await memberRow(g.people.alice.memberId);
        assert.deepEqual([row!.status, row!.left_at], ['left', NOW]);
      });

      it('最後の1人で、グループが消えることを確認した（acknowledgeDelete）なら、グループのデータをすべて消す', async () => {
        const g = await setup(['alice']);
        await insertClosing(db, g.groupId, '2026-11', g.people.alice.memberId);
        const result = await api.requestLeave(g.people.alice, g.groupId, { acknowledgeDelete: true });
        assert.deepEqual(result.body, { leaveRequestedMonth: '2026-11', confirmed: true, groupDeleted: true });
        assert.equal(await groupCount(g.groupId), 0);
      });

      it('最後の1人でも、確認の申告が無ければ、何も消さずに409 delete_not_acknowledged。申告つきで送り直すと消える', async () => {
        const g = await setup(['alice']);
        await insertClosing(db, g.groupId, '2026-11', g.people.alice.memberId);
        const refused = await api.requestLeave(g.people.alice, g.groupId);
        assert.deepEqual([refused.status, refused.body], [409, { error: 'delete_not_acknowledged' }]);
        // 何も書かれていない: グループも、脱退の選択も残る
        assert.equal(await groupCount(g.groupId), 1);
        assert.equal((await memberRow(g.people.alice.memberId))!.leave_requested_month, null);
        const retry = await api.requestLeave(g.people.alice, g.groupId, { acknowledgeDelete: true });
        assert.equal(retry.status, 200);
        assert.equal(await groupCount(g.groupId), 0);
      });

      it('警告を出した画面が古くて（残る人が、脱退済みになった）、申告が無いとき: 読み直すと leaveDeletesGroup が true になる', async () => {
        // alice の画面を読んだ時点では、bob が脱退が確定して精算を待っている（leaving）ので、最後の1人ではない
        const g = await setup(['alice', 'bob'], { bob: { status: 'leaving', expenseEndMonth: '2026-10', leaveRequestedMonth: '2026-10' } });
        await insertClosing(db, g.groupId, '2026-11', g.people.alice.memberId);
        // そのあと、bob が脱退済みになった
        await db.prepare(`UPDATE group_members SET status = 'left', left_at = ? WHERE id = ?`).bind(NOW, g.people.bob.memberId).run();
        const refused = await api.requestLeave(g.people.alice, g.groupId);
        assert.deepEqual([refused.status, refused.body], [409, { error: 'delete_not_acknowledged' }]);
        assert.equal(await groupCount(g.groupId), 1);
      });

      it('確認の申告は、グループが消えない操作には効かない（無視する）', async () => {
        const g = await setup(['alice', 'bob']);
        await insertClosing(db, g.groupId, '2026-11', g.people.bob.memberId);
        const result = await api.requestLeave(g.people.alice, g.groupId, { acknowledgeDelete: true });
        assert.equal(result.status, 200);
        assert.equal(result.body.groupDeleted, undefined);
        assert.equal(await groupCount(g.groupId), 1);
      });
    });

    it('最後の1人でも、脱退月が締められていなければ、脱退を選ぶだけ（グループは消えない。確定のときに消える）', async () => {
      const g = await setup(['alice']);
      const result = await api.requestLeave(g.people.alice, g.groupId);
      assert.deepEqual(result.body, { leaveRequestedMonth: '2026-11', confirmed: false });
      assert.equal(await groupCount(g.groupId), 1);
    });
  });

  describe('脱退の取り消し（DELETE /groups/:id/leave）', () => {
    it('確定するまで（脱退月の間）は取り消せる。取り消したあとは、もう一度選べる', async () => {
      const g = await setup(['alice', 'bob']);
      await api.requestLeave(g.people.alice, g.groupId);
      const before = await dataVersion(g.groupId);
      const result = await api.cancelLeave(g.people.alice, g.groupId);
      assert.deepEqual([result.status, result.body], [200, { leaveRequestedMonth: null }]);
      assert.equal((await memberRow(g.people.alice.memberId))!.leave_requested_month, null);
      assert.equal(await dataVersion(g.groupId), before + 1);
      assert.equal((await api.requestLeave(g.people.alice, g.groupId)).status, 200);
    });

    it('選んでいなければ409 not_leaving。脱退月が終わったあと（Cronの確定の前でも）・確定したあとは409 leave_confirmed', async () => {
      const g = await setup(['alice', 'bob', 'carol'], {
        alice: { leaveRequestedMonth: '2026-11' },
        carol: { status: 'leaving', expenseEndMonth: '2026-11', leaveRequestedMonth: '2026-11' },
      });
      assert.deepEqual((await api.cancelLeave(g.people.bob, g.groupId)).body, { error: 'not_leaving' });
      assert.deepEqual((await api.cancelLeave(g.people.alice, g.groupId, { now: NOW_DECEMBER })).body, {
        error: 'leave_confirmed',
      });
      assert.deepEqual((await api.cancelLeave(g.people.carol, g.groupId)).body, { error: 'leave_confirmed' });
      assert.equal((await memberRow(g.people.alice.memberId))!.leave_requested_month, '2026-11', '取り消されていない');
    });

    it('認証・所属: セッション無し401、メンバーでない人・脱退済みは404', async () => {
      const g = await setup(['alice']);
      const left = await factory.addPerson(g.groupId, 'erin', { status: 'left', expenseEndMonth: '2026-10' });
      assert.equal((await api.cancelLeave(null, g.groupId)).status, 401);
      for (const who of [await factory.addUser('visitor'), left] as Person[]) {
        assert.equal((await api.cancelLeave(who, g.groupId)).status, 404);
      }
    });

    it('競合: 別の書き込みが入ったら409 conflict。何も書かれない', async () => {
      const g = await setup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-11' } });
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(g.groupId).run();
      const result = await api.cancelLeave(g.people.alice, g.groupId, { env: interferingEnv(env, bump) });
      assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);
      assert.equal((await memberRow(g.people.alice.memberId))!.leave_requested_month, '2026-11');
    });

    it('月締めで確定したあとは取り消せない（脱退月を締めた時点で確定する）', async () => {
      const g = await setup(['alice', 'bob']);
      await api.requestLeave(g.people.alice, g.groupId);
      // 最初の支出が11月なので、11月を最初に締められる。送金（bob → alice）が残るので、alice は leaving になる。
      await insertExpenseRow(db, {
        groupId: g.groupId,
        categoryId: g.categoryId,
        payerMemberId: g.people.alice.memberId,
        amountMinor: 6000,
        targetMonth: '2026-11',
      });
      assert.equal((await months.close(g.people.bob, g.groupId, '2026-11')).status, 201);
      assert.equal((await memberRow(g.people.alice.memberId))!.status, 'leaving');
      assert.deepEqual((await api.cancelLeave(g.people.alice, g.groupId)).body, { error: 'leave_confirmed' });
    });
  });
});
