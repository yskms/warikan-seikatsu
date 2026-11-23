/// <reference types="node" />
// 月次集計・月締め・締め結果のAPI（src/closings.ts）の検査。規則は docs/backend-design.md 3章・4章・8章、
// 形は9章「月締め・精算API」。ローカルD1（miniflare）での検査なので、確かめるのはロジック。競合は
// 「読んだあとに別の書き込みが入った」状況で再現して確かめている（本番D1での確認は13章の9）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import worker from '../src/index.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertExpenseRow,
  NOW,
  type MemberOptions,
  type Person,
} from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { countingEnv, interferingEnv, monthApi, NOW_DECEMBER, read, request } from './monthApi.ts';

describe('月次集計・月締め・締め結果のAPI', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let api: ReturnType<typeof monthApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    api = monthApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  // --- 準備の道具 -------------------------------------------------------------------------------

  /** 名前のメンバーが2026-10から参加しているグループ。2026-10の費目の割合は均等。 */
  const setup = async <Name extends string>(
    names: readonly Name[],
    options: Partial<Record<Name, MemberOptions>> = {},
  ) => {
    const group = await factory.createGroup(names, options);
    const ids = names.map((name) => group.people[name].memberId);
    await insertCategoryRule(db, group.groupId, group.categoryId, '2026-10', equalShares(ids));
    return group;
  };

  const pay = (
    group: { groupId: string; categoryId: string },
    who: Person,
    amountMinor: number,
    month = '2026-10',
    split?: Parameters<typeof insertExpenseRow>[1]['split'],
    categoryId = group.categoryId,
  ) =>
    insertExpenseRow(db, { groupId: group.groupId, categoryId, payerMemberId: who.memberId, amountMinor, targetMonth: month, split });

  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  const count = async (table: string, groupId: string) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE group_id = ?`).bind(groupId).first<{ n: number }>())!.n;
  const memberRow = (memberId: string) =>
    db
      .prepare('SELECT status, left_at FROM group_members WHERE id = ?')
      .bind(memberId)
      .first<{ status: string; left_at: number | null }>();
  const bump = (groupId: string) =>
    db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(groupId).run();

  /** 締められず、何も書かれなかったこと。 */
  const assertNotWritten = async (groupId: string, versionBefore: number, closingsBefore: number) => {
    assert.equal(await dataVersion(groupId), versionBefore);
    assert.equal(await count('monthly_closings', groupId), closingsBefore);
  };

  // === 月次集計 ================================================================================

  describe('月次集計（GET /groups/:id/months/:month/summary）', () => {
    it('締める前の月は、支出から計算した見込みを返す', async () => {
      const g = await setup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await pay(g, alice, 10000);
      await pay(g, bob, 4000);

      const result = await api.summary(alice, g.groupId, '2026-10');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {
        month: '2026-10',
        closed: false,
        closing: null,
        totalMinor: 14000,
        members: [
          { memberId: alice.memberId, displayName: 'alice', paidMinor: 10000, burdenMinor: 7000, differenceMinor: 3000, carriedInMinor: 0, netMinor: 3000 },
          { memberId: bob.memberId, displayName: 'bob', paidMinor: 4000, burdenMinor: 7000, differenceMinor: -3000, carriedInMinor: 0, netMinor: -3000 },
        ],
        categories: [
          {
            categoryId: g.categoryId,
            totalMinor: 14000,
            burdens: [
              { memberId: alice.memberId, burdenMinor: 7000 },
              { memberId: bob.memberId, burdenMinor: 7000 },
            ],
          },
        ],
        transfers: [{ fromMemberId: bob.memberId, toMemberId: alice.memberId, amountMinor: 3000 }],
        close: { closable: true },
      });
    });

    it('個別設定の支出は、費目の割合で分けず、保存した負担額を使う（費目の合計には入る）', async () => {
      const g = await setup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await pay(g, alice, 10000);
      await pay(g, alice, 3000, '2026-10', { method: 'single', allocations: [[bob.memberId, 3000]] });

      const { body } = await api.summary(alice, g.groupId, '2026-10');
      assert.equal(body.totalMinor, 13000);
      assert.deepEqual(
        body.members.map((m: { paidMinor: number; burdenMinor: number; netMinor: number }) => [m.paidMinor, m.burdenMinor, m.netMinor]),
        [
          [13000, 5000, 8000],
          [0, 8000, -8000],
        ],
      );
      assert.deepEqual(body.categories[0], {
        categoryId: g.categoryId,
        totalMinor: 13000,
        burdens: [
          { memberId: alice.memberId, burdenMinor: 5000 },
          { memberId: bob.memberId, burdenMinor: 8000 },
        ],
      });
    });

    it('上限額つきの負担: 月合計が上限以下・ちょうど上限・上限超えの3通り（3章の例）', async () => {
      for (const [total, expectedAlice, expectedBob] of [
        [8000, 8000, 0],
        [10000, 10000, 0],
        [15000, 10000, 5000],
      ] as const) {
        const g = await factory.createGroup(['alice', 'bob']);
        const { alice, bob } = g.people;
        // 超えた分の割合は、自分0%・相手100%。上限は自分の10,000円。
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 0], [bob.memberId, 10000]], {
          memberId: alice.memberId,
          capMinor: 10000,
        });
        await pay(g, alice, total);
        const { body } = await api.summary(alice, g.groupId, '2026-10');
        assert.deepEqual(
          body.members.map((m: { burdenMinor: number }) => m.burdenMinor),
          [expectedAlice, expectedBob],
          `月合計 ${total}`,
        );
      }
    });

    it('3人の均等割りは、端数を固定順で配り、送金は支払側から受取側へ組み合わせる', async () => {
      const g = await setup(['alice', 'bob', 'carol']);
      const { alice, bob, carol } = g.people;
      await pay(g, alice, 10000);

      const { body } = await api.summary(alice, g.groupId, '2026-10');
      assert.deepEqual(
        body.members.map((m: { burdenMinor: number; netMinor: number }) => [m.burdenMinor, m.netMinor]),
        [
          [3334, 6666],
          [3333, -3333],
          [3333, -3333],
        ],
      );
      assert.deepEqual(body.transfers, [
        { fromMemberId: bob.memberId, toMemberId: alice.memberId, amountMinor: 3333 },
        { fromMemberId: carol.memberId, toMemberId: alice.memberId, amountMinor: 3333 },
      ]);
    });

    it('支出に関わらないメンバーも、その月に参加していれば、0で並ぶ', async () => {
      const g = await factory.createGroup(['alice', 'bob', 'carol']);
      const { alice, bob, carol } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 5000], [bob.memberId, 5000], [carol.memberId, 0]]);
      await pay(g, alice, 1000);

      const { body } = await api.summary(alice, g.groupId, '2026-10');
      assert.deepEqual(
        body.members.map((m: { memberId: string }) => m.memberId),
        [alice.memberId, bob.memberId, carol.memberId],
      );
      assert.deepEqual(body.members[2], {
        memberId: carol.memberId,
        displayName: 'carol',
        paidMinor: 0,
        burdenMinor: 0,
        differenceMinor: 0,
        carriedInMinor: 0,
        netMinor: 0,
      });
    });

    it('集計に出るのは、その月に参加しているメンバー（参加月から脱退月まで。削除したユーザーも、削除した月までは入る）', async () => {
      const f = await factory();
      const ids = [f.alice, f.bob, f.carol].map((p) => p.memberId);
      await insertCategoryRule(db, f.groupId, f.categoryId, '2026-10', equalShares(ids));
      await pay(f, f.alice, 3000, '2026-10');
      await pay(f, f.alice, 3000, '2026-11');
      const idsOf = (body: { members: { memberId: string }[] }) => body.members.map((m) => m.memberId);

      const october = await api.summary(f.alice, f.groupId, '2026-10');
      // 10月: 脱退が11月のcarol、10月に削除したdave、10月に脱退したerin も参加していた。新しいメンバーはまだ。
      assert.deepEqual(idsOf(october.body), [f.alice.memberId, f.bob.memberId, f.carol.memberId, f.daveMemberId, f.erin.memberId]);

      const november = await api.summary(f.alice, f.groupId, '2026-11');
      assert.deepEqual(idsOf(november.body), [f.alice.memberId, f.bob.memberId, f.carol.memberId, f.newbie.memberId]);
    });

    it('費目の割合は、その月以前で最も新しい月の設定を引き継ぐ', async () => {
      const g = await factory.createGroup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 7000], [bob.memberId, 3000]]);
      await pay(g, alice, 500, '2026-10');
      await pay(g, alice, 10000, '2026-11');

      const { body } = await api.summary(alice, g.groupId, '2026-11');
      assert.deepEqual(
        body.members.map((m: { burdenMinor: number }) => m.burdenMinor),
        [7000, 3000],
      );
      // 10月が未締めで、10月に支出があるので、11月は締められない。
      assert.deepEqual(body.close, { closable: false, reason: 'previous_month_not_closed', month: '2026-10' });
    });

    it('まだ始まっていない月は、集計できるが、締められないと添える', async () => {
      const g = await setup(['alice', 'bob']);
      const { body } = await api.summary(g.people.alice, g.groupId, '2026-12');
      assert.equal(body.totalMinor, 0);
      assert.deepEqual(body.transfers, []);
      assert.deepEqual(body.close, { closable: false, reason: 'month_not_started' });
    });

    it('その月のメンバーでない人には、締められないと添える（脱退月が終わったメンバー）', async () => {
      const g = await setup(['alice', 'bob'], { bob: { leaveRequestedMonth: '2026-10' } });
      const { body } = await api.summary(g.people.alice, g.groupId, '2026-10');
      assert.deepEqual(body.close, { closable: true });
      const december = await api.summary(g.people.bob, g.groupId, '2026-12', { now: NOW_DECEMBER });
      assert.equal(december.status, 200);
      assert.deepEqual(december.body.close, { closable: false, reason: 'forbidden' });
    });

    it('認証・所属・月の閲覧範囲の判定', async () => {
      const f = await factory();
      await insertCategoryRule(db, f.groupId, f.categoryId, '2026-10', equalShares([f.alice.memberId, f.bob.memberId]));

      assert.deepEqual((await api.summary(null, f.groupId, '2026-10')).body, { error: 'unauthorized' });
      for (const who of [f.outsider, f.other.member, f.erin]) {
        const result = await api.summary(who, f.groupId, '2026-10');
        assert.deepEqual([result.status, result.body], [404, { error: 'not_found' }]);
      }
      // 参加前の月は見られない。
      const early = await api.summary(f.newbie, f.groupId, '2026-10');
      assert.deepEqual([early.status, early.body], [403, { error: 'forbidden' }]);
      // 脱退が確定したメンバー（leaving）は、見られる。
      assert.equal((await api.summary(f.carol, f.groupId, '2026-10')).status, 200);
    });
  });

  // === 月締め ===================================================================================

  describe('月締め（POST /groups/:id/months/:month/close）', () => {
    it('締めると、見込みと同じ集計が確定し、送金が未処理で作られる', async () => {
      const g = await setup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await pay(g, alice, 10000);
      await pay(g, bob, 4000);
      const preview = (await api.summary(alice, g.groupId, '2026-10')).body;
      const versionBefore = await dataVersion(g.groupId);

      const result = await api.close(bob, g.groupId, '2026-10');
      assert.equal(result.status, 201);
      const view = result.body;
      assert.deepEqual(view.closing, { id: view.closing.id, closedAt: NOW, closedByMemberId: bob.memberId, processed: false });
      assert.equal(typeof view.closing.id, 'string');
      assert.equal(view.month, '2026-10');
      assert.equal(view.closed, true);
      // 見込みと同じ集計。
      assert.equal(view.totalMinor, preview.totalMinor);
      assert.deepEqual(view.members, preview.members);
      assert.deepEqual(view.categories, preview.categories);
      assert.deepEqual(
        view.transfers.map((t: Record<string, unknown>) => ({ ...t, id: undefined })),
        [
          {
            id: undefined,
            fromMemberId: bob.memberId,
            toMemberId: alice.memberId,
            amountMinor: 3000,
            status: 'pending',
            settledAt: null,
            carriedAt: null,
            processedByMemberId: null,
            canCarry: true,
          },
        ],
      );

      // 締めの記録。バージョンは1つ上がり、締めの記録にそのバージョンが残る。
      assert.equal(await dataVersion(g.groupId), versionBefore + 1);
      const row = await db
        .prepare('SELECT * FROM monthly_closings WHERE group_id = ?')
        .bind(g.groupId)
        .first<Record<string, unknown>>();
      assert.deepEqual(row, {
        id: view.closing.id,
        group_id: g.groupId,
        target_month: '2026-10',
        currency_code: 'JPY',
        currency_minor_unit: 0,
        data_version: versionBefore + 1,
        closed_by_member_id: bob.memberId,
        closed_at: NOW,
      });
      assert.equal(await count('closing_member_summaries', g.groupId), 2);
      assert.equal(await count('closing_category_burdens', g.groupId), 2);
      assert.equal(await count('settlement_transfers', g.groupId), 1);
    });

    it('締めた結果は、締め結果（closing）と、締めた月の summary から同じ内容で読める', async () => {
      const g = await setup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await pay(g, alice, 10000);
      const closed = (await api.close(alice, g.groupId, '2026-10')).body;

      const closing = await api.closing(bob, g.groupId, '2026-10');
      assert.deepEqual([closing.status, closing.body], [200, closed]);
      const summary = await api.summary(bob, g.groupId, '2026-10');
      assert.deepEqual(summary.body, { ...closed, close: { closable: false, reason: 'month_closed' } });
    });

    it('締めていない月の closing は 404（not_closed）。参加前の月は403、他のグループは404', async () => {
      const f = await factory();
      assert.deepEqual((await api.closing(f.alice, f.groupId, '2026-10')).body, { error: 'not_closed' });
      assert.equal((await api.closing(f.newbie, f.groupId, '2026-10')).status, 403);
      assert.equal((await api.closing(f.other.member, f.groupId, '2026-10')).status, 404);
      assert.equal((await api.closing(null, f.groupId, '2026-10')).status, 401);
    });

    it('送金が0件の月（全員の差額がゼロ）は、締めた時点で処理済み', async () => {
      const g = await setup(['alice', 'bob']);
      const { alice, bob } = g.people;
      await pay(g, alice, 5000);
      await pay(g, bob, 5000);

      const result = await api.close(alice, g.groupId, '2026-10');
      assert.equal(result.status, 201);
      assert.deepEqual(result.body.transfers, []);
      assert.equal(result.body.closing.processed, true);
    });

    it('支出が1件も無い月も締められる（全員0）', async () => {
      const g = await setup(['alice', 'bob']);
      const result = await api.close(g.people.alice, g.groupId, '2026-10');
      assert.equal(result.status, 201);
      assert.equal(result.body.totalMinor, 0);
      assert.deepEqual(result.body.categories, []);
      assert.equal(result.body.members.length, 2);
      assert.equal(result.body.closing.processed, true);
    });

    it('締めた時点の名前が残る（あとで名前が変わっても、締めた結果は変わらない）', async () => {
      const g = await setup(['alice', 'bob']);
      await pay(g, g.people.alice, 1000);
      await api.close(g.people.alice, g.groupId, '2026-10');
      await db.prepare(`UPDATE group_members SET display_name = '削除されたユーザー' WHERE id = ?`).bind(g.people.bob.memberId).run();

      const { body } = await api.closing(g.people.alice, g.groupId, '2026-10');
      assert.deepEqual(
        body.members.map((m: { displayName: string }) => m.displayName),
        ['alice', 'bob'],
      );
    });

    it('通貨の小数桁数（USD 2・KWD 3）に依らず、金額は最小単位の整数のまま計算し、締めた時点の通貨を残す', async () => {
      for (const [currency, minorUnit] of [
        ['USD', 2],
        ['KWD', 3],
      ] as const) {
        const g = await setup(['alice', 'bob']);
        await db
          .prepare('UPDATE expense_groups SET currency_code = ?, currency_minor_unit = ? WHERE id = ?')
          .bind(currency, minorUnit, g.groupId)
          .run();
        // 12.345 KWD（12345）・123.45 USD（12345）。2人の均等割りの端数は、固定順の先頭に1単位。
        await pay(g, g.people.alice, 12345);

        const { body } = await api.close(g.people.bob, g.groupId, '2026-10');
        assert.equal(body.transfers.length, 1);
        assert.equal(body.transfers[0].amountMinor, 6172, currency);
        assert.deepEqual(
          await db
            .prepare('SELECT currency_code, currency_minor_unit FROM monthly_closings WHERE group_id = ?')
            .bind(g.groupId)
            .first(),
          { currency_code: currency, currency_minor_unit: minorUnit },
        );
      }
    });

    describe('締められない条件（4章）', () => {
      it('まだ始まっていない月（12月に11月19日）', async () => {
        const g = await setup(['alice', 'bob']);
        const before = await dataVersion(g.groupId);
        const result = await api.close(g.people.alice, g.groupId, '2026-12');
        assert.deepEqual([result.status, result.body], [409, { error: 'month_not_started' }]);
        await assertNotWritten(g.groupId, before, 0);
      });

      it('すでに締めた月（二重締め）', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000);
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-10')).status, 201);
        const before = await dataVersion(g.groupId);

        const again = await api.close(g.people.bob, g.groupId, '2026-10');
        assert.deepEqual([again.status, again.body], [409, { error: 'month_closed' }]);
        await assertNotWritten(g.groupId, before, 1);
      });

      it('前の月が未締め', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000, '2026-10');
        await pay(g, g.people.alice, 1000, '2026-11');
        const before = await dataVersion(g.groupId);

        const result = await api.close(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual([result.status, result.body], [409, { error: 'previous_month_not_closed', month: '2026-10' }]);
        await assertNotWritten(g.groupId, before, 0);
      });

      it('前の月が未締め: 飛ばした月がある（11月を飛ばして12月）', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000, '2026-10');
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-10')).status, 201);

        const result = await api.close(g.people.alice, g.groupId, '2026-12', { now: NOW_DECEMBER });
        assert.deepEqual([result.status, result.body], [409, { error: 'previous_month_not_closed', month: '2026-11' }]);
      });

      it('前の月の送金が未処理（pending）のまま', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000, '2026-10');
        const october = (await api.close(g.people.alice, g.groupId, '2026-10')).body;
        const before = await dataVersion(g.groupId);

        const blocked = await api.close(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual([blocked.status, blocked.body], [409, { error: 'previous_month_unsettled', month: '2026-10' }]);
        await assertNotWritten(g.groupId, before, 1);

        // 精算済みにすれば、締められる。
        assert.equal((await api.settle(g.people.bob, october.transfers[0].id)).status, 200);
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-11')).status, 201);
      });

      it('操作者がその月のメンバーでない（参加前の月、脱退月が終わった月）', async () => {
        const g = await setup(['alice', 'bob', 'carol'], {
          carol: { status: 'leaving', expenseEndMonth: '2026-10' },
          bob: { historyFromMonth: '2026-11' },
        });
        // bob は11月から。10月は締められない。carol は10月で脱退。11月は締められない。
        const early = await api.close(g.people.bob, g.groupId, '2026-10');
        assert.deepEqual([early.status, early.body], [403, { error: 'forbidden' }]);
        const late = await api.close(g.people.carol, g.groupId, '2026-11');
        assert.deepEqual([late.status, late.body], [403, { error: 'forbidden' }]);
      });

      it('認証・所属: セッション無し401、メンバーでない人・他のグループ・脱退済みは404', async () => {
        const f = await factory();
        const before = await dataVersion(f.groupId);
        assert.equal((await api.close(null, f.groupId, '2026-10')).status, 401);
        for (const who of [f.outsider, f.other.member, f.erin]) {
          const result = await api.close(who, f.groupId, '2026-10');
          assert.deepEqual([result.status, result.body], [404, { error: 'not_found' }]);
        }
        assert.equal((await api.close(f.alice, 'no-such-group', '2026-10')).status, 404);
        await assertNotWritten(f.groupId, before, 0);
      });

      it('最後に締めた月より前の月は、締めていなくても締められない', async () => {
        const g = await setup(['alice', 'bob']);
        // 10月に支出が無く、11月が最初の月。11月を締めたあとは、10月を締めると順序が崩れる。
        await pay(g, g.people.alice, 1000, '2026-11');
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-11')).status, 201);

        // 締め済みではないので、`month_closed` ではなく `month_skipped`。summary も、`closed: false` のまま同じ理由を返す。
        const result = await api.close(g.people.alice, g.groupId, '2026-10');
        assert.deepEqual([result.status, result.body], [409, { error: 'month_skipped' }]);
        const summary = await api.summary(g.people.alice, g.groupId, '2026-10');
        assert.equal(summary.body.closed, false);
        assert.deepEqual(summary.body.close, { closable: false, reason: 'month_skipped' });
      });
    });

    describe('グループで最初の月', () => {
      it('作成月に支出が無く、翌月に最初の支出を登録したグループは、作成月を締めずに、翌月を締められる', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000, '2026-11');
        const summary = await api.summary(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual(summary.body.close, { closable: true });
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-11')).status, 201);
      });

      it('支出が1件も無いグループは、作成月を先に締める', async () => {
        const g = await setup(['alice', 'bob']);
        const blocked = await api.close(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual([blocked.status, blocked.body], [409, { error: 'previous_month_not_closed', month: '2026-10' }]);

        assert.equal((await api.close(g.people.alice, g.groupId, '2026-10')).status, 201);
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-11')).status, 201);
      });

      it('より前の月に支出があれば、そちらが最初の月になる', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000, '2026-11');
        await pay(g, g.people.alice, 1000, '2026-10');
        const blocked = await api.close(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual([blocked.status, blocked.body], [409, { error: 'previous_month_not_closed', month: '2026-10' }]);
      });
    });

    describe('繰越', () => {
      it('繰り越した送金は、翌月の精算する額にだけ足され、支出の総額・負担額には入らない', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        await pay(g, alice, 6000, '2026-10'); // bob → alice 3,000
        const october = (await api.close(alice, g.groupId, '2026-10')).body;
        assert.equal((await api.carry(bob, october.transfers[0].id)).status, 200);
        await pay(g, alice, 4000, '2026-11'); // その月の差額は bob → alice 2,000（割合は10月のものを引き継ぐ）

        // 締める前の見込みにも、繰越が入る。
        const preview = (await api.summary(bob, g.groupId, '2026-11')).body;
        assert.deepEqual(preview.close, { closable: true });
        assert.equal(preview.totalMinor, 4000);
        assert.deepEqual(
          preview.members.map((m: { burdenMinor: number; differenceMinor: number; carriedInMinor: number; netMinor: number }) => [
            m.burdenMinor,
            m.differenceMinor,
            m.carriedInMinor,
            m.netMinor,
          ]),
          [
            [2000, 2000, 3000, 5000],
            [2000, -2000, -3000, -5000],
          ],
        );
        assert.deepEqual(preview.transfers, [{ fromMemberId: bob.memberId, toMemberId: alice.memberId, amountMinor: 5000 }]);

        const november = await api.close(bob, g.groupId, '2026-11');
        assert.equal(november.status, 201);
        assert.deepEqual(november.body.members, preview.members);
        assert.equal(november.body.transfers[0].amountMinor, 5000);
        // 締めた結果にも、カテゴリごとの負担額に繰越は入らない。
        assert.deepEqual(november.body.categories[0].burdens, [
          { memberId: alice.memberId, burdenMinor: 2000 },
          { memberId: bob.memberId, burdenMinor: 2000 },
        ]);
      });

      it('何か月続けて繰り越しても、金額を二重に数えない（毎月、前の月の締めの carried だけを足す）', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        await pay(g, alice, 6000, '2026-10'); // bob → alice 3,000
        const october = (await api.close(alice, g.groupId, '2026-10')).body;
        assert.equal((await api.carry(bob, october.transfers[0].id)).status, 200);

        // 11月は支出なし。10月の繰越だけで、bob → alice 3,000。これも繰り越す。
        const november = (await api.close(alice, g.groupId, '2026-11')).body;
        assert.equal(november.transfers[0].amountMinor, 3000);
        assert.equal((await api.carry(bob, november.transfers[0].id)).status, 200);

        // 12月も支出なし。11月の繰越（10月分を含む3,000）だけ。10月分を重ねて6,000にはならない。
        const december = (await api.close(alice, g.groupId, '2026-12', { now: NOW_DECEMBER })).body;
        assert.equal(december.transfers.length, 1);
        assert.equal(december.transfers[0].amountMinor, 3000);
        assert.deepEqual(
          december.members.map((m: { carriedInMinor: number }) => m.carriedInMinor),
          [3000, -3000],
        );
      });

      it('精算済み（settled）にした送金は、繰越に入らない', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        await pay(g, alice, 6000, '2026-10');
        const october = (await api.close(alice, g.groupId, '2026-10')).body;
        assert.equal((await api.settle(bob, october.transfers[0].id)).status, 200);

        const november = await api.close(alice, g.groupId, '2026-11');
        assert.deepEqual(november.body.transfers, []);
        assert.deepEqual(
          november.body.members.map((m: { carriedInMinor: number }) => m.carriedInMinor),
          [0, 0],
        );
      });

      it('3人で、新しいメンバーが加わった月に繰り越すと、送金の組み合わせが変わる。送金の合計は各自の精算する額と一致する', async () => {
        const g = await factory.createGroup(['alice', 'bob', 'carol'], { carol: { historyFromMonth: '2026-11' } });
        const { alice, bob, carol } = g.people;
        // 10月は alice と bob の2人（carol は11月から）。割合も2人。
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 5000], [bob.memberId, 5000]]);
        await pay(g, alice, 6000, '2026-10'); // bob → alice 3,000
        const october = (await api.close(alice, g.groupId, '2026-10')).body;
        assert.equal((await api.carry(bob, october.transfers[0].id)).status, 200);

        // 11月は3人で均等。carol が9,000円を払う。
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', equalShares([alice.memberId, bob.memberId, carol.memberId]));
        await pay(g, carol, 9000, '2026-11');
        const november = (await api.close(carol, g.groupId, '2026-11')).body;

        // 負担額: alice 3,001 / bob 3,000 / carol 2,999。差額: -3,001 / -3,000 / +6,001。繰越: +3,000 / -3,000。
        assert.deepEqual(
          november.members.map((m: { netMinor: number }) => m.netMinor),
          [-1, -6000, 6001],
        );
        assert.deepEqual(
          november.transfers.map((t: { fromMemberId: string; toMemberId: string; amountMinor: number }) => [
            t.fromMemberId,
            t.toMemberId,
            t.amountMinor,
          ]),
          [
            [alice.memberId, carol.memberId, 1],
            [bob.memberId, carol.memberId, 6000],
          ],
        );
        // 送金の合計（受取は+、支払は-）が、メンバーごとの精算する額と一致する。
        const net = new Map<string, number>();
        for (const t of november.transfers) {
          net.set(t.toMemberId, (net.get(t.toMemberId) ?? 0) + t.amountMinor);
          net.set(t.fromMemberId, (net.get(t.fromMemberId) ?? 0) - t.amountMinor);
        }
        for (const m of november.members) assert.equal(net.get(m.memberId) ?? 0, m.netMinor);
      });
    });

    describe('引き継いだ割合の確定（3章）', () => {
      it('月の行が無い費目は、引き継いだ割合と上限額を、この月の行として書く。既にある月の行は変えない', async () => {
        const g = await factory.createGroup(['alice', 'bob']);
        const { alice, bob } = g.people;
        const second = await factory.addCategory(g.groupId, 'rent');
        // 食費: 10月の設定（上限額つき）を引き継ぐ。家賃: 11月の行が既にある。
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 0], [bob.memberId, 10000]], {
          memberId: alice.memberId,
          capMinor: 10000,
        });
        await insertCategoryRule(db, g.groupId, second, '2026-10', [[alice.memberId, 5000], [bob.memberId, 5000]]);
        await insertCategoryRule(db, g.groupId, second, '2026-11', [[alice.memberId, 2000], [bob.memberId, 8000]]);
        assert.equal((await api.close(alice, g.groupId, '2026-10')).status, 201);
        assert.equal((await api.close(alice, g.groupId, '2026-11')).status, 201);

        const settings = (
          await db
            .prepare(
              `SELECT category_id, target_month, cap_member_id, cap_minor FROM category_month_settings
                WHERE group_id = ? AND target_month = '2026-11' ORDER BY category_id`,
            )
            .bind(g.groupId)
            .all<{ category_id: string; cap_member_id: string | null; cap_minor: number | null }>()
        ).results;
        const byCategory = new Map(settings.map((row) => [row.category_id, row]));
        assert.equal(byCategory.size, 2);
        assert.equal(byCategory.get(g.categoryId)!.cap_member_id, alice.memberId);
        assert.equal(byCategory.get(g.categoryId)!.cap_minor, 10000);
        assert.equal(byCategory.get(second)!.cap_member_id, null);

        const shares = (
          await db
            .prepare(
              `SELECT category_id, member_id, share_basis_points FROM category_month_shares
                WHERE group_id = ? AND target_month = '2026-11'`,
            )
            .bind(g.groupId)
            .all<{ category_id: string; member_id: string; share_basis_points: number }>()
        ).results;
        const shareOf = (categoryId: string, memberId: string) =>
          shares.find((row) => row.category_id === categoryId && row.member_id === memberId)?.share_basis_points;
        assert.equal(shareOf(g.categoryId, alice.memberId), 0);
        assert.equal(shareOf(g.categoryId, bob.memberId), 10000);
        assert.equal(shareOf(second, alice.memberId), 2000, '既にある11月の行は変えない');
        assert.equal(shareOf(second, bob.memberId), 8000);
        assert.equal(shares.length, 4);
      });

      it('アーカイブした費目は、その月に支出がなければ、設定を引き継いで書かない（支出があれば書く）', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        const ids = [alice.memberId, bob.memberId];
        const unused = await factory.addCategory(g.groupId, 'unused', true);
        const used = await factory.addCategory(g.groupId, 'used', true);
        for (const categoryId of [unused, used]) await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
        assert.equal((await api.close(alice, g.groupId, '2026-10')).status, 201);

        // 11月は、アーカイブした費目 used の支出だけがある（アーカイブしても、費目を変えなければ編集できる）。
        await pay(g, alice, 2000, '2026-11', undefined, used);
        const november = await api.close(alice, g.groupId, '2026-11');
        assert.equal(november.status, 201, JSON.stringify(november.body));
        assert.equal(november.body.categories.length, 1);

        const written = (
          await db
            .prepare(`SELECT category_id FROM category_month_settings WHERE group_id = ? AND target_month = '2026-11'`)
            .bind(g.groupId)
            .all<{ category_id: string }>()
        ).results.map((row) => row.category_id);
        assert.deepEqual(written.sort(), [g.categoryId, used].sort());
        assert.equal(
          (await db.prepare(`SELECT count(*) AS n FROM category_month_shares WHERE group_id = ? AND target_month = '2026-11' AND category_id = ?`).bind(g.groupId, unused).first<{ n: number }>())!.n,
          0,
        );
      });

      it('費目やメンバーが多く、1文に収まらない行数でも、締められる（複数行のINSERTを分ける）', async () => {
        const g = await setup(['alice', 'bob', 'carol']);
        const { alice, bob, carol } = g.people;
        const ids = [alice, bob, carol].map((p) => p.memberId);
        const categoryIds = [g.categoryId];
        for (let i = 0; i < 12; i += 1) {
          const categoryId = await factory.addCategory(g.groupId, `c${i}`);
          await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
          categoryIds.push(categoryId);
        }
        for (const categoryId of categoryIds) await pay(g, alice, 3000, '2026-10', undefined, categoryId);

        const october = await api.close(alice, g.groupId, '2026-10');
        assert.equal(october.status, 201);
        assert.equal(october.body.categories.length, 13);
        assert.equal(await count('closing_category_burdens', g.groupId), 13 * 3);
        for (const transfer of october.body.transfers) assert.equal((await api.settle(alice, transfer.id)).status, 200);

        assert.equal((await api.close(alice, g.groupId, '2026-11')).status, 201);
        assert.equal(
          (await db.prepare(`SELECT count(*) AS n FROM category_month_settings WHERE group_id = ? AND target_month = '2026-11'`).bind(g.groupId).first<{ n: number }>())!.n,
          13,
        );
        assert.equal(
          (await db.prepare(`SELECT count(*) AS n FROM category_month_shares WHERE group_id = ? AND target_month = '2026-11'`).bind(g.groupId).first<{ n: number }>())!.n,
          13 * 3,
        );
      });
    });

    describe('D1のクエリ数（batch の文を1つずつ数える。Freeは1回の呼び出しにつき50まで）', () => {
      // 行ごとのINSERTに戻すと、費目13・メンバー3の月締めで、書き込みだけで100文近くになる。
      it('行数が多い月締めでも、複数行を1文にまとめているので、文の数が少ない', async () => {
        const g = await setup(['alice', 'bob', 'carol']);
        const { alice } = g.people;
        const ids = [alice, g.people.bob, g.people.carol].map((p) => p.memberId);
        const categoryIds = [g.categoryId];
        for (let i = 0; i < 12; i += 1) {
          const categoryId = await factory.addCategory(g.groupId, `c${i}`);
          await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
          categoryIds.push(categoryId);
        }
        for (const categoryId of categoryIds) await pay(g, alice, 3000, '2026-10', undefined, categoryId);
        const october = await api.close(alice, g.groupId, '2026-10');
        for (const transfer of october.body.transfers) assert.equal((await api.settle(alice, transfer.id)).status, 200);

        // 11月は、全費目の設定を引き継ぎ（13行 + 割合39行）、全費目に支出がある（負担39行）。
        for (const categoryId of categoryIds) await pay(g, alice, 3000, '2026-11', undefined, categoryId);
        const counting = countingEnv(env);
        const november = await api.close(alice, g.groupId, '2026-11', { env: counting.env });
        assert.equal(november.status, 201, JSON.stringify(november.body));
        assert.equal(await count('category_month_shares', g.groupId), 13 * 3 * 2);

        // 書き込みの batch は2回目。バージョンの更新1 + 設定1 + 割合3 + 締め1 + 集計1 + 負担3 + 送金1 + 脱退1。
        const [stateReads, writes, viewReads] = counting.counts.batchSizes;
        assert.deepEqual([stateReads, viewReads], [10, 5]);
        assert.equal(writes, 12);
        // 認証・バージョン・権限の読み込みを含めて、1文ずつ数えても、Freeの上限（50）に十分収まる。
        assert.ok(counting.counts.queries <= 35, `クエリ数 ${counting.counts.queries}`);
      });
    });

    describe('D1のクエリ数: 脱退の確定を含む月締め', () => {
      // 脱退の確定が入ると、費目・割合の行がある月の読み込み2回と、割合のリセット（削除2文と複数行の挿入）・招待の取り消し・
      // 固定費の停止・状態の更新の、約10文が増える（確定が無い月締めは、費目13・メンバー3で約25。docs 9章）。
      const closeWithLeaver = async (categoryCount: number) => {
        const g = await setup(['alice', 'bob', 'carol'], { alice: { leaveRequestedMonth: '2026-10' } });
        const ids = [g.people.alice, g.people.bob, g.people.carol].map((p) => p.memberId);
        const categoryIds = [g.categoryId];
        for (let i = 1; i < categoryCount; i += 1) {
          const categoryId = await factory.addCategory(g.groupId, `c${i}`);
          await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
          categoryIds.push(categoryId);
        }
        for (const categoryId of categoryIds) await pay(g, g.people.bob, 3000, '2026-10', undefined, categoryId);
        const counting = countingEnv(env);
        const closed = await api.close(g.people.bob, g.groupId, '2026-10', { env: counting.env });
        assert.equal(closed.status, 201, JSON.stringify(closed.body));
        assert.equal((await count('category_month_shares', g.groupId)) >= categoryCount * 2, true, 'リセットで、翌月の割合が書かれた');
        return counting.counts;
      };

      it('費目1つ・メンバー3人: 実測34（状態の読み込み10・書き込み14・結果の読み込み5と、認証・バージョン・権限など）', async () => {
        const counts = await closeWithLeaver(1);
        assert.deepEqual(counts.batchSizes, [10, 14, 5]);
        assert.ok(counts.queries <= 40, `クエリ数 ${counts.queries}`);
      });

      it('費目13・メンバー3人: 実測37。複数行を1文にまとめているので、費目が増えても、ほとんど増えない', async () => {
        const counts = await closeWithLeaver(13);
        assert.deepEqual(counts.batchSizes, [10, 17, 5]);
        assert.ok(counts.queries <= 42, `クエリ数 ${counts.queries}`);
      });
    });

    // 費目の数の上限(MAX_CATEGORIES_PER_GROUP。30)と、メンバー6人の組み合わせ。上限の根拠(docs 9章)の実測。
    // 割合を直していない月は、前の月の行を引き継ぐので、締めるときに設定30行と割合180行を書き足す。よくある月は
    // こちらなので、「引き継ぐ月」を測る。「締める月に行がある月」は、書き足しが無い下限（グループを作った最初の月など）。
    describe('D1のクエリ数: 費目の上限(30)・メンバー6人', () => {
      const closeFullGroup = async (options: { inherit: boolean; leaver: boolean }) => {
        const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] as const;
        const month = options.inherit ? '2026-11' : '2026-10';
        // 脱退の確定は、締める月の分（脱退月 = 締める月）。
        const g = await setup(names, options.leaver ? { a1: { leaveRequestedMonth: month } } : {});
        const ids = names.map((name) => g.people[name].memberId);
        const categoryIds = [g.categoryId];
        for (let i = 1; i < 30; i += 1) {
          const categoryId = await factory.addCategory(g.groupId, `c${i}`);
          await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
          categoryIds.push(categoryId);
        }
        for (const categoryId of categoryIds) await pay(g, g.people.a2, 3000, '2026-10', undefined, categoryId);
        if (options.inherit) {
          // 10月を締めて精算してから、10月の行を引き継ぐ11月を締める。
          const october = await api.close(g.people.a2, g.groupId, '2026-10');
          assert.equal(october.status, 201, JSON.stringify(october.body));
          for (const transfer of october.body.transfers) assert.equal((await api.settle(g.people.a2, transfer.id)).status, 200);
          for (const categoryId of categoryIds) await pay(g, g.people.a2, 3000, '2026-11', undefined, categoryId);
        }
        const counting = countingEnv(env);
        const closed = await api.close(g.people.a2, g.groupId, month, { env: counting.env });
        assert.equal(closed.status, 201, JSON.stringify(closed.body));
        if (options.inherit) {
          assert.equal(
            (await db.prepare(`SELECT count(*) AS n FROM category_month_settings WHERE group_id = ? AND target_month = '2026-11'`).bind(g.groupId).first<{ n: number }>())!.n,
            30,
            '締めるときに、設定30行を引き継いで書いた',
          );
        }
        return counting.counts;
      };

      it('引き継ぐ月の月締め（よくある月）: 実測47。1文ずつ数えて、Freeの上限(50)にぎりぎり収まる', async () => {
        const counts = await closeFullGroup({ inherit: true, leaver: false });
        // 状態の読み込み10 + 書き込み29（バージョン1・設定2・割合10・締め1・集計1・負担12・送金1・脱退1）+ 結果の読み込み5。
        assert.deepEqual(counts.batchSizes, [10, 29, 5]);
        assert.ok(counts.queries <= 50, `クエリ数 ${counts.queries}`);
      });

      it('引き継ぐ月で、脱退の確定を含む月締め: 実測65。1文ずつ数えると、Freeの上限(50)を超える(その数え方ではPaid前提。公式の数え方なら収まる。docs 8章・9章)', async () => {
        const counts = await closeFullGroup({ inherit: true, leaver: true });
        assert.deepEqual(counts.batchSizes, [10, 45, 5]);
        assert.ok(counts.queries > 50 && counts.queries <= 70, `クエリ数 ${counts.queries}`);
      });

      it('締める月に行がある月（下限）: 実測35', async () => {
        const counts = await closeFullGroup({ inherit: false, leaver: false });
        assert.deepEqual(counts.batchSizes, [10, 17, 5]);
        assert.ok(counts.queries <= 40, `クエリ数 ${counts.queries}`);
      });

      it('締める月に行がある月で、脱退の確定を含む: 実測53', async () => {
        const counts = await closeFullGroup({ inherit: false, leaver: true });
        assert.deepEqual(counts.batchSizes, [10, 33, 5]);
        assert.ok(counts.queries > 50 && counts.queries <= 60, `クエリ数 ${counts.queries}`);
      });
    });

    describe('脱退が確定したメンバー（5章）', () => {
      it('関わる送金が0件なら、締めた時点で脱退済みになる', async () => {
        const g = await factory.createGroup(['alice', 'bob', 'carol'], { carol: { status: 'leaving', expenseEndMonth: '2026-10' } });
        const { alice, bob, carol } = g.people;
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', [[alice.memberId, 5000], [bob.memberId, 5000], [carol.memberId, 0]]);
        await pay(g, alice, 1000);

        assert.equal((await api.close(alice, g.groupId, '2026-10')).status, 201);
        assert.deepEqual(await memberRow(carol.memberId), { status: 'left', left_at: NOW });
        // 関係のないメンバーは変わらない。
        assert.equal((await memberRow(alice.memberId))!.status, 'active');
      });

      it('関わる送金があれば、脱退が確定したまま残る（精算済みにしたとき、脱退済みになる。transfers.test.ts）', async () => {
        const g = await factory.createGroup(['alice', 'bob', 'carol'], { carol: { status: 'leaving', expenseEndMonth: '2026-10' } });
        const { alice, bob, carol } = g.people;
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([alice, bob, carol].map((p) => p.memberId)));
        await pay(g, carol, 3000);

        assert.equal((await api.close(alice, g.groupId, '2026-10')).status, 201);
        assert.equal((await memberRow(carol.memberId))!.status, 'leaving');
      });

      it('繰越先の月を締めた結果、脱退者の精算する額が0で送金が作られないなら、その締めの中で脱退済みになる', async () => {
        const g = await setup(['alice', 'bob', 'carol']);
        const { alice, bob, carol } = g.people;
        // 10月（支出なし）を締める。alice の繰越が「alice → bob」と「carol → alice」の同じ額で打ち消し合う状態を、
        // SQLで作る（送金の組み合わせの計算は、1人が払う側と受け取る側を兼ねないので、締めからは作れない）。
        const october = await api.close(alice, g.groupId, '2026-10');
        assert.equal(october.status, 201);
        const closingId = (
          await db.prepare(`SELECT id FROM monthly_closings WHERE group_id = ? AND target_month = '2026-10'`).bind(g.groupId).first<{ id: string }>()
        )!.id;
        for (const [from, to] of [[alice, bob], [carol, alice]]) {
          await db
            .prepare(
              `INSERT INTO settlement_transfers (id, group_id, closing_id, from_member_id, to_member_id, amount_minor,
                 status, carried_at, processed_by_member_id)
               VALUES (?, ?, ?, ?, ?, 1000, 'carried', ?, ?)`,
            )
            .bind(`carried-${from.memberId}-${to.memberId}`, g.groupId, closingId, from.memberId, to.memberId, NOW, bob.memberId)
            .run();
        }
        // alice は10月で脱退が確定している。11月には参加しない。
        await db
          .prepare(`UPDATE group_members SET status = 'leaving', expense_end_month = '2026-10' WHERE id = ?`)
          .bind(alice.memberId)
          .run();
        assert.equal((await memberRow(alice.memberId))!.status, 'leaving');

        // 11月: bob が +1,000、carol が -1,000、alice は 0。送金は carol → bob の1件だけ。
        const november = await api.close(bob, g.groupId, '2026-11');
        assert.equal(november.status, 201, JSON.stringify(november.body));
        assert.deepEqual(
          november.body.transfers.map((t: { fromMemberId: string; toMemberId: string; amountMinor: number }) => [t.fromMemberId, t.toMemberId, t.amountMinor]),
          [[carol.memberId, bob.memberId, 1000]],
        );
        const aliceSummary = november.body.members.find((m: { memberId: string }) => m.memberId === alice.memberId);
        assert.deepEqual([aliceSummary.carriedInMinor, aliceSummary.netMinor], [0, 0]);
        // 関わる送金が無く、繰越先の月（11月）も締めたので、同じ書き込みの中で脱退済みになる。
        assert.deepEqual(await memberRow(alice.memberId), { status: 'left', left_at: NOW });
      });

      it('脱退月がまだ締められていなければ、他の月を締めても脱退済みにならない', async () => {
        const g = await factory.createGroup(['alice', 'bob', 'carol'], { carol: { status: 'leaving', expenseEndMonth: '2026-11' } });
        const { alice, bob, carol } = g.people;
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([alice, bob, carol].map((p) => p.memberId)));
        await pay(g, alice, 1000);
        assert.equal((await api.close(alice, g.groupId, '2026-10')).status, 201);
        assert.equal((await memberRow(carol.memberId))!.status, 'leaving');
      });
    });

    describe('競合（8章）', () => {
      it('検証のあとに別のリクエストが書いたら、やり直さずに409（conflict）で、何も書かれない', async () => {
        const g = await setup(['alice', 'bob']);
        await pay(g, g.people.alice, 1000);
        const before = await dataVersion(g.groupId);

        const result = await api.close(g.people.alice, g.groupId, '2026-10', {
          env: interferingEnv(env, () => bump(g.groupId), { skipBatches: 1 }),
        });
        assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);
        assert.equal(await dataVersion(g.groupId), before + 1); // 別のリクエストの1回分だけ
        assert.equal(await count('monthly_closings', g.groupId), 0);
        assert.equal(await count('closing_member_summaries', g.groupId), 0);
        assert.equal(await count('closing_category_burdens', g.groupId), 0);
        assert.equal(await count('settlement_transfers', g.groupId), 0);

        // 読み直して締め直せる。
        assert.equal((await api.close(g.people.alice, g.groupId, '2026-10')).status, 201);
      });

      it('締める直前に支出が登録されたら、古い集計では締まらない（登録された支出を含めて、締め直す）', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        await pay(g, alice, 1000);
        const result = await api.close(alice, g.groupId, '2026-10', {
          env: interferingEnv(
            env,
            async () => {
              // 支出の登録（バージョンも上がる）。
              await pay(g, bob, 9000);
              await bump(g.groupId);
            },
            { skipBatches: 1 },
          ),
        });
        assert.equal(result.status, 409);
        assert.equal(await count('monthly_closings', g.groupId), 0);

        const retried = await api.close(alice, g.groupId, '2026-10');
        assert.equal(retried.status, 201);
        assert.equal(retried.body.totalMinor, 10000);
      });

      it('2人が同時に締めると、片方だけが締まる', async () => {
        const g = await setup(['alice', 'bob']);
        const { alice, bob } = g.people;
        await pay(g, alice, 1000);
        // alice が読んだあと、書く前に、bob が締めた。
        const result = await api.close(alice, g.groupId, '2026-10', {
          env: interferingEnv(env, async () => {
            assert.equal((await api.close(bob, g.groupId, '2026-10')).status, 201);
          }, { skipBatches: 1 }),
        });
        assert.deepEqual([result.status, result.body], [409, { error: 'conflict' }]);
        assert.equal(await count('monthly_closings', g.groupId), 1);
        assert.equal(await count('closing_member_summaries', g.groupId), 2, '締めの中身も1回分だけ');
        const closing = await api.closing(alice, g.groupId, '2026-10');
        assert.equal(closing.body.closing.closedByMemberId, bob.memberId);
      });
    });
  });

  // === ルーティング =============================================================================

  describe('ルーティング', () => {
    const call = async (method: string, path: string, token: string | null = null) =>
      read(await worker.fetch(request(method, path, token), env));

    it('月の形が違う・知らないパスは404（JSON）', async () => {
      for (const path of [
        '/groups/g1/months/2026-13/summary',
        '/groups/g1/months/2026-1/close',
        '/groups/g1/months/2026-10/unknown',
        '/groups/bad id/months/2026-10/summary',
        '/transfers/t1/unknown',
      ]) {
        const result = await call('GET', path);
        assert.deepEqual([path, result.status, result.body], [path, 404, { error: 'not_found' }]);
      }
    });

    it('メソッドが違えば405（許可するメソッドを添える）', async () => {
      const summary = await worker.fetch(request('POST', '/groups/g1/months/2026-10/summary', null), env);
      assert.deepEqual([summary.status, summary.headers.get('allow')], [405, 'GET']);
      const closing = await worker.fetch(request('DELETE', '/groups/g1/months/2026-10/closing', null), env);
      assert.deepEqual([closing.status, closing.headers.get('allow')], [405, 'GET']);
      const close = await worker.fetch(request('GET', '/groups/g1/months/2026-10/close', null), env);
      assert.deepEqual([close.status, close.headers.get('allow')], [405, 'POST']);
      const settle = await worker.fetch(request('GET', '/transfers/t1/settle', null), env);
      assert.deepEqual([settle.status, settle.headers.get('allow')], [405, 'POST']);
    });

    it('セッション無しは401', async () => {
      for (const [method, path] of [
        ['GET', '/groups/g1/months/2026-10/summary'],
        ['GET', '/groups/g1/months/2026-10/closing'],
        ['POST', '/groups/g1/months/2026-10/close'],
        ['POST', '/transfers/t1/settle'],
        ['POST', '/transfers/t1/carry'],
      ] as const) {
        const result = await call(method, path);
        assert.deepEqual([path, result.status, result.body], [path, 401, { error: 'unauthorized' }]);
      }
    });
  });
});
