/// <reference types="node" />
// アカウント削除のデータ処理（src/accountDeletion.ts）の検査。規則は docs/backend-design.md 5章「アカウント削除」、
// 競合制御は8章。再認証は `POST /auth/delete` の側（deleteAccount.test.ts）で見るので、ここでは、データ処理の関数を直接呼ぶ。
// ローカルD1（miniflare）での検査なので、確かめるのはロジック。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { deleteAccount } from '../src/accountDeletion.ts';
import { DELETED_USER_NAME } from '../src/membership.ts';
import { authenticateSession } from '../src/session.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertExpenseRow,
  insertInviteRow,
  insertRecurringRow,
  NOW,
  type MemberOptions,
  type Person,
} from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { countingEnv, interferingEnv, monthApi } from './monthApi.ts';

describe('アカウント削除のデータ処理', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let months: ReturnType<typeof monthApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    months = monthApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  // --- 準備の道具 -------------------------------------------------------------------------------

  /** 名前のメンバーのグループ（2026-10から参加中）。2026-10の割合は均等。 */
  const setup = async <Name extends string>(
    names: readonly Name[],
    options: Partial<Record<Name, MemberOptions>> = {},
  ) => {
    const group = await factory.createGroup(names, options);
    await insertCategoryRule(
      db,
      group.groupId,
      group.categoryId,
      '2026-10',
      equalShares(names.map((name) => group.people[name].memberId)),
    );
    return group;
  };
  /** 既存のユーザー（`who`）を、別のグループにメンバーとして足す。 */
  const addTo = (groupId: string, who: Person, name: string, options: MemberOptions = {}) =>
    factory.addMember(groupId, name, who.userId, options);

  const memberRow = (memberId: string) =>
    db
      .prepare('SELECT user_id, display_name, status, expense_end_month, leave_requested_month, left_at FROM group_members WHERE id = ?')
      .bind(memberId)
      .first<{
        user_id: string | null;
        display_name: string;
        status: string;
        expense_end_month: string | null;
        leave_requested_month: string | null;
        left_at: number | null;
      }>();
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())
      ?.data_version ?? null;
  const count = async (sql: string, ...values: unknown[]) =>
    (await db.prepare(sql).bind(...values).first<{ n: number }>())!.n;
  const userExists = async (userId: string) => (await count('SELECT count(*) AS n FROM users WHERE id = ?', userId)) === 1;
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
  const pausedReason = async (recurringId: string) =>
    (
      await db
        .prepare('SELECT paused_reason FROM recurring_expenses WHERE id = ?')
        .bind(recurringId)
        .first<{ paused_reason: string | null }>()
    )!.paused_reason;
  const revokedAt = async (inviteId: string) =>
    (await db.prepare('SELECT revoked_at FROM invites WHERE id = ?').bind(inviteId).first<{ revoked_at: number | null }>())!
      .revoked_at;

  // === グループごとの扱い =====================================================================

  describe('グループごとの扱い', () => {
    it('残るメンバーがいるグループは匿名化し、自分だけのグループは消す。脱退済み・脱退が確定したグループも匿名化する', async () => {
      // A: alice（参加中）と bob。10月は締め済みで、bob → alice の送金が未処理。
      const a = await setup(['alice', 'bob']);
      const alice = a.people.alice;
      await insertExpenseRow(db, {
        groupId: a.groupId,
        categoryId: a.categoryId,
        payerMemberId: alice.memberId,
        amountMinor: 6000,
        targetMonth: '2026-10',
      });
      const closed = await months.close(alice, a.groupId, '2026-10');
      assert.equal(closed.status, 201, JSON.stringify(closed.body));
      const transferId = closed.body.transfers[0].id as string;
      const aliceInvite = await insertInviteRow(db, { groupId: a.groupId, invitedByMemberId: alice.memberId });
      const bobInvite = await insertInviteRow(db, { groupId: a.groupId, invitedByMemberId: a.people.bob.memberId });
      const aliceCategory = await insertRecurringRow(db, { groupId: a.groupId, categoryId: a.categoryId, payerMemberId: alice.memberId });
      const aliceEqual = await insertRecurringRow(db, {
        groupId: a.groupId,
        categoryId: a.categoryId,
        payerMemberId: alice.memberId,
        splitMethod: 'equal',
      });
      const bobEqual = await insertRecurringRow(db, {
        groupId: a.groupId,
        categoryId: a.categoryId,
        payerMemberId: a.people.bob.memberId,
        splitMethod: 'equal',
      });
      const bobCategory = await insertRecurringRow(db, { groupId: a.groupId, categoryId: a.categoryId, payerMemberId: a.people.bob.memberId });

      // B: alice だけ。
      const b = await setup(['zoe']);
      await db.prepare('UPDATE group_members SET user_id = ? WHERE id = ?').bind(alice.userId, b.people.zoe.memberId).run();
      await insertExpenseRow(db, {
        groupId: b.groupId,
        categoryId: b.categoryId,
        payerMemberId: b.people.zoe.memberId,
        amountMinor: 1000,
        targetMonth: '2026-10',
      });

      // C: alice は脱退済み（left）。carol・dave が残る。
      const c = await setup(['carol', 'dave']);
      const aliceInC = await addTo(c.groupId, alice, 'alice', { status: 'left', expenseEndMonth: '2026-10', historyFromMonth: '2026-09' });
      await db.prepare('UPDATE group_members SET left_at = 77 WHERE id = ?').bind(aliceInC).run();

      // D: alice は脱退が確定した（leaving）。erin が残る。
      const d = await setup(['erin']);
      const aliceInD = await addTo(d.groupId, alice, 'alice', { status: 'leaving', expenseEndMonth: '2026-11', leaveRequestedMonth: '2026-11' });

      // X: 無関係のグループ。
      const x = await setup(['xavier']);

      const versions = {
        a: await dataVersion(a.groupId),
        c: await dataVersion(c.groupId),
        d: await dataVersion(d.groupId),
        x: await dataVersion(x.groupId),
      };
      const result = await deleteAccount(db, alice.userId, NOW);
      assert.deepEqual(result, { status: 'deleted', deletedGroups: 1, anonymizedGroups: 3 });

      // ユーザー・ログイン手段・セッションが消え、セッションでは引けない。
      assert.equal(await userExists(alice.userId), false);
      assert.equal(await count('SELECT count(*) AS n FROM identities WHERE user_id = ?', alice.userId), 0);
      assert.equal(await authenticateSession(db, alice.token, NOW), null);

      // A: 匿名化。参加中だったので、集計に入る最後の月は今月（2026-11）。
      assert.deepEqual(await memberRow(alice.memberId), {
        user_id: null,
        display_name: DELETED_USER_NAME,
        status: 'deleted',
        expense_end_month: '2026-11',
        leave_requested_month: null,
        left_at: null,
      });
      assert.equal((await memberRow(a.people.bob.memberId))!.display_name, 'bob');
      assert.deepEqual(
        (
          await db
            .prepare('SELECT member_id, display_name_snapshot FROM closing_member_summaries WHERE group_id = ? ORDER BY member_id')
            .bind(a.groupId)
            .all<{ member_id: string; display_name_snapshot: string }>()
        ).results.map((row) => [row.member_id, row.display_name_snapshot]),
        [
          [alice.memberId, DELETED_USER_NAME],
          [a.people.bob.memberId, 'bob'],
        ].sort((p, q) => (p[0]! < q[0]! ? -1 : 1)),
      );
      // 翌月（2026-12）の割合は、残る bob だけでの均等に。
      assert.deepEqual(await sharesOf(a.categoryId, '2026-12'), [[a.people.bob.memberId, 10000]]);
      assert.notEqual(await revokedAt(aliceInvite.id), null);
      assert.equal(await revokedAt(bobInvite.id), null);
      assert.deepEqual(
        [await pausedReason(aliceCategory), await pausedReason(aliceEqual), await pausedReason(bobEqual), await pausedReason(bobCategory)],
        ['payer_left', 'payer_left', 'member_changed', null],
      );
      assert.equal(await dataVersion(a.groupId), versions.a! + 1);

      // B: グループごと消える。
      assert.equal(await dataVersion(b.groupId), null);
      for (const table of ['group_members', 'expenses', 'categories', 'category_month_shares']) {
        assert.equal(await count(`SELECT count(*) AS n FROM ${table} WHERE group_id = ?`, b.groupId), 0, table);
      }

      // C・D: 匿名化するが、すでに確定した脱退の記録（脱退月・脱退した時刻）はそのまま。割合のリセットは起きない。
      assert.deepEqual(await memberRow(aliceInC), {
        user_id: null,
        display_name: DELETED_USER_NAME,
        status: 'deleted',
        expense_end_month: '2026-10',
        leave_requested_month: null,
        left_at: 77,
      });
      assert.deepEqual(await memberRow(aliceInD), {
        user_id: null,
        display_name: DELETED_USER_NAME,
        status: 'deleted',
        expense_end_month: '2026-11',
        leave_requested_month: '2026-11',
        left_at: null,
      });
      assert.equal((await sharesOf(c.categoryId, '2026-11')).length, 0);
      assert.equal((await sharesOf(d.categoryId, '2026-12')).length, 0);
      assert.deepEqual([await dataVersion(c.groupId), await dataVersion(d.groupId)], [versions.c! + 1, versions.d! + 1]);

      // X: 無関係のグループは変わらない。
      assert.equal(await dataVersion(x.groupId), versions.x);
      assert.equal((await memberRow(x.people.xavier.memberId))!.status, 'active');

      // 削除した月（2026-11）までの集計には、「削除されたユーザー」として含まれる。翌月からは含まれない。
      const november = await months.summary(a.people.bob, a.groupId, '2026-11');
      const inNovember = (november.body.members as { memberId: string; displayName: string }[]).find((m) => m.memberId === alice.memberId);
      assert.equal(inNovember?.displayName, DELETED_USER_NAME);
      const december = await months.summary(a.people.bob, a.groupId, '2026-12', { now: Date.UTC(2026, 11, 19, 3, 0, 0) });
      assert.equal(
        (december.body.members as { memberId: string }[]).some((m) => m.memberId === alice.memberId),
        false,
      );

      // 削除したユーザーが関わる送金は、繰り越せず、精算済みにはできる。
      const carry = await months.carry(a.people.bob, transferId);
      assert.deepEqual([carry.status, carry.body], [409, { error: 'transfer_not_carryable' }]);
      assert.equal((await months.settle(a.people.bob, transferId)).status, 200);
    });

    it('脱退を選んだ月がすでに終わっている（Cronの確定の前の）メンバーは、その月を最後の月にする', async () => {
      const g = await setup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-10' } });
      assert.equal((await deleteAccount(db, g.people.alice.userId, NOW)).status, 'deleted');
      const row = await memberRow(g.people.alice.memberId);
      assert.deepEqual([row!.status, row!.expense_end_month], ['deleted', '2026-10']);
      // リセットされるのは、その翌月（2026-11）。
      assert.deepEqual(await sharesOf(g.categoryId, '2026-11'), [[g.people.bob.memberId, 10000]]);
    });

    it('脱退を選んだ月が、最初の締めで飛ばされた月でも、締めた月の割合には触れず、最初の未締めの月から直す', async () => {
      const g = await setup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-10' } });
      const ids = [g.people.alice.memberId, g.people.bob.memberId];
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', equalShares(ids));
      await insertClosing(db, g.groupId, '2026-11', g.people.bob.memberId);
      assert.equal((await deleteAccount(db, g.people.alice.userId, NOW)).status, 'deleted');
      // 最後の月は脱退月（2026-10）。リセットの対象は翌月（2026-11）だが、すでに締められているので触れず、
      // 締めた月の割合を引き継ぐ、最初の未締めの月（2026-12）から、bob だけに直す。
      assert.equal((await memberRow(g.people.alice.memberId))!.expense_end_month, '2026-10');
      assert.equal((await sharesOf(g.categoryId, '2026-11')).length, 2);
      assert.deepEqual(await sharesOf(g.categoryId, '2026-12'), [[g.people.bob.memberId, 10000]]);
    });

    it('翌月より後に割合の行がある月（別のメンバーの削除が書いたものなど）も、あわせて直す', async () => {
      const g = await setup(['alice', 'bob', 'carol']);
      const { alice, bob, carol } = g.people;
      await deleteAccount(db, bob.userId, NOW); // 2026-12 の行が、alice・carol の2人で書かれる
      assert.equal((await sharesOf(g.categoryId, '2026-12')).length, 2);
      // さらに先の月にも、行がある（3人のまま）。
      await insertCategoryRule(db, g.groupId, g.categoryId, '2027-01', equalShares([alice.memberId, bob.memberId, carol.memberId]));

      assert.equal((await deleteAccount(db, alice.userId, NOW)).status, 'deleted');
      assert.deepEqual(await sharesOf(g.categoryId, '2026-12'), [[carol.memberId, 10000]]);
      assert.deepEqual(await sharesOf(g.categoryId, '2027-01'), [[carol.memberId, 10000]]);
      assert.equal((await sharesOf(g.categoryId, '2026-11')).length, 0, '今月（2026-11）には行が無く、2026-10 のものを引き継ぐ。書き込まない');
    });

    it('脱退済み・削除済みのメンバーしか残らないグループは、自分が脱退済みでも消す（誰も見られないグループを残さない）', async () => {
      const g = await setup(['bob'], { bob: { status: 'left', expenseEndMonth: '2026-10' } });
      const alice = await factory.addUser('alice');
      await factory.addMember(g.groupId, 'alice', alice.userId, { status: 'left', expenseEndMonth: '2026-10' });
      await factory.addMember(g.groupId, 'dave', null, { status: 'deleted', expenseEndMonth: '2026-10' });
      assert.deepEqual(await deleteAccount(db, alice.userId, NOW), { status: 'deleted', deletedGroups: 1, anonymizedGroups: 0 });
      assert.equal(await dataVersion(g.groupId), null);
    });

    it('自分以外に、脱退が確定した（leaving）メンバーだけが残っていても、グループは消えない（その人の精算が残っている）', async () => {
      const g = await setup(['alice'], {});
      await factory.addMember(g.groupId, 'carol', null, { status: 'leaving', expenseEndMonth: '2026-10' });
      assert.deepEqual(await deleteAccount(db, g.people.alice.userId, NOW), {
        status: 'deleted',
        deletedGroups: 0,
        anonymizedGroups: 1,
      });
      assert.notEqual(await dataVersion(g.groupId), null);
    });

    it('グループに入っていないユーザーも消せる。2回呼んでも同じ（すでに消えていれば、削除済み）', async () => {
      const lonely = await factory.addUser('lonely');
      assert.deepEqual(await deleteAccount(db, lonely.userId, NOW), { status: 'deleted', deletedGroups: 0, anonymizedGroups: 0 });
      assert.equal(await userExists(lonely.userId), false);
      assert.equal(await authenticateSession(db, lonely.token, NOW), null);
      assert.deepEqual(await deleteAccount(db, lonely.userId, NOW), { status: 'deleted', deletedGroups: 0, anonymizedGroups: 0 });
    });
  });

  // === 競合 ===================================================================================

  describe('競合（8章）', () => {
    it('関わるグループの1つに別の書き込みが入ったら、どのグループも変えずにやり直す。続けて競合したら conflict（何も変わらない）', async () => {
      const a = await setup(['alice', 'bob']);
      const alice = a.people.alice;
      const b = await setup(['zoe', 'yuki']);
      await addTo(b.groupId, alice, 'alice');
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(a.groupId).run();
      const before = [await dataVersion(a.groupId), await dataVersion(b.groupId)];

      const result = await deleteAccount(interferingEnv(env, bump, { times: 3 }).DB, alice.userId, NOW);
      assert.deepEqual(result, { status: 'conflict' });
      assert.equal(await userExists(alice.userId), true);
      assert.equal((await memberRow(alice.memberId))!.status, 'active');
      // a は割り込みの3回分だけ。b は、一度も上がっていない（一部のグループだけ書き込まない）。
      assert.deepEqual([await dataVersion(a.groupId), await dataVersion(b.groupId)], [before[0]! + 3, before[1]]);

      // 割り込みが止めば、削除できる。
      assert.equal((await deleteAccount(db, alice.userId, NOW)).status, 'deleted');
    });

    it('1回の競合なら、読み直してやり直して、削除できる', async () => {
      const a = await setup(['alice', 'bob']);
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(a.groupId).run();
      const result = await deleteAccount(interferingEnv(env, bump).DB, a.people.alice.userId, NOW);
      assert.equal(result.status, 'deleted');
      assert.equal((await memberRow(a.people.alice.memberId))!.status, 'deleted');
    });

    it('読んだあとに、別のグループへ参加されても、そのグループを取りこぼさない（本人の匿名化が、残らない）', async () => {
      const a = await setup(['alice', 'bob']);
      const alice = a.people.alice;
      const e = await setup(['emma']); // alice が、削除の処理の途中で参加するグループ
      let joined: string | null = null;
      const joinElsewhere = async () => {
        joined = await addTo(e.groupId, alice, 'alice');
      };
      const result = await deleteAccount(interferingEnv(env, joinElsewhere).DB, alice.userId, NOW);
      assert.deepEqual(result, { status: 'deleted', deletedGroups: 0, anonymizedGroups: 2 });
      assert.notEqual(joined, null);
      // 1回目は、新しい参加があったので、何も書かれず、2回目で両方のグループを処理した。
      assert.deepEqual(await memberRow(joined!), {
        user_id: null,
        display_name: DELETED_USER_NAME,
        status: 'deleted',
        expense_end_month: '2026-11',
        leave_requested_month: null,
        left_at: null,
      });
      assert.equal(await count('SELECT count(*) AS n FROM group_members WHERE user_id = ?', alice.userId), 0);
      assert.equal(await userExists(alice.userId), false);
    });
  });
});

describe('アカウント削除のD1のクエリ数（Freeは1回の呼び出しにつき50まで）', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
  });
  after(async () => {
    await local.dispose();
  });

  /** alice が、k個のグループ（それぞれ、ほかに2人）に参加中。 */
  const aliceInGroups = async (k: number) => {
    const alice = await factory.addUser('alice');
    for (let i = 0; i < k; i++) {
      const g = await factory.createGroup(['zed', 'yan']);
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([g.people.zed.memberId, g.people.yan.memberId]));
      await factory.addMember(g.groupId, 'alice', alice.userId, {});
    }
    return alice;
  };

  it('読み込みは、グループの数によらず、固定の6回。書き込みの文が、グループごとに増える', async () => {
    const perGroup: number[] = [];
    for (const k of [1, 2, 3, 5]) {
      const alice = await aliceInGroups(k);
      const counting = countingEnv(env);
      assert.equal((await deleteAccount(counting.env.DB, alice.userId, NOW)).status, 'deleted');
      const [writes] = counting.counts.batchSizes;
      // 読み込み: 所属・バージョン・メンバー・費目・最後に締めた月・割合の行の月。
      assert.equal(counting.counts.queries - writes!, 6, `${k}グループ`);
      perGroup.push(writes!);
    }
    // 書き込み: バージョンの更新1 + ユーザーの削除1 + グループごとの匿名化（メンバー・スナップショット・
    // 割合のリセット4・招待・固定費2の、約9文）。
    assert.deepEqual(
      perGroup.map((n, index) => (n - 2) / [1, 2, 3, 5][index]!),
      [9, 9, 9, 9],
    );
    // データ処理だけなら、Freeの上限（50）に収まるのは、グループ数が4つまで（6 + 2 + 9×4 = 44。5つで53）。Paid（1000）では、100グループ以上。
    // POST /auth/delete 全体（認証・T の使用済み・やり直し・自分だけのグループ）は、もっと多い。test/deleteAccount.test.ts の「D1のクエリ数」。
    assert.ok(6 + perGroup[2]! <= 50);
    assert.ok(6 + perGroup[3]! > 50);
  });
});
