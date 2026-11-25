/// <reference types="node" />
// 割合を均等に戻した印（`category_month_settings.member_changed_at`。お知らせ「メンバーが増減した」）の検査。
// 規則は docs/backend-design.md 5章の「参加」と、9章の「費目・負担割合API」の「見直しの確認」。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { deleteAccount } from '../src/accountDeletion.ts';
import worker from '../src/index.ts';
import { confirmEndedLeaves } from '../src/membership.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertExpenseRow,
  insertInviteRow,
  NOW,
} from './apiFixture.ts';
import { groupsApi } from './groupsApi.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { interferingEnv, monthApi, NOW_DECEMBER, read, request } from './monthApi.ts';

describe('割合を均等に戻した印（メンバーの増減のお知らせ）', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let api: ReturnType<typeof groupsApi>;
  let members: ReturnType<typeof membershipApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    api = groupsApi(env);
    members = membershipApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  /** alice・bob の2人（2026-10から）と、費目2つ（food・rent）。2026-10の割合は均等で、印は無い。 */
  const setup = async () => {
    const g = await factory.createGroup(['alice', 'bob']);
    const rentId = await factory.addCategory(g.groupId, 'rent');
    const ids = [g.people.alice.memberId, g.people.bob.memberId];
    for (const categoryId of [g.categoryId, rentId]) {
      await insertCategoryRule(db, g.groupId, categoryId, '2026-10', equalShares(ids));
    }
    return { ...g, rentId };
  };
  const join = async (g: Awaited<ReturnType<typeof setup>>, name = 'visitor') => {
    const invite = await insertInviteRow(db, { groupId: g.groupId, invitedByMemberId: g.people.alice.memberId });
    const result = await members.join(await factory.addUser(name), invite.token);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.memberId as string;
  };
  const marks = async (groupId: string) =>
    (
      await db
        .prepare(
          `SELECT category_id, target_month, member_changed_at FROM category_month_settings
            WHERE group_id = ? ORDER BY target_month, category_id`,
        )
        .bind(groupId)
        .all<{ category_id: string; target_month: string; member_changed_at: number | null }>()
    ).results;
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  const rule = (body: { categories: { categoryId: string; memberChangedAt: number | null }[] }, categoryId: string) =>
    body.categories.find((category) => category.categoryId === categoryId)!;

  describe('印を付けるとき', () => {
    it('参加で割合を戻した行に、戻した時刻が入る。ほかの月・手で書いた行は印なし', async () => {
      const g = await setup();
      await join(g);
      const rows = await marks(g.groupId);
      assert.deepEqual(
        rows.map((row) => [row.target_month, row.member_changed_at]),
        [
          ['2026-10', null],
          ['2026-10', null],
          ['2026-11', NOW],
          ['2026-11', NOW],
        ],
      );
    });

    it('取得で、費目ごとに印の時刻を返す（戻した月以降は、引き継ぎ元の行の印）', async () => {
      const g = await setup();
      await join(g);
      for (const month of ['2026-11', '2026-12']) {
        const got = await api.getRules(g.people.alice, g.groupId, month);
        assert.equal(got.status, 200, JSON.stringify(got.body));
        assert.deepEqual(
          got.body.categories.map((category: { memberChangedAt: number | null }) => category.memberChangedAt),
          [NOW, NOW],
          month,
        );
      }
      const before = await api.getRules(g.people.alice, g.groupId, '2026-10');
      assert.deepEqual(
        before.body.categories.map((category: { memberChangedAt: number | null }) => category.memberChangedAt),
        [null, null],
        '戻す前の月は印なし',
      );
    });

    it('脱退の確定で、翌月の行に印が付く', async () => {
      const g = await setup();
      assert.equal((await members.requestLeave(g.people.bob, g.groupId)).status, 200);
      // 脱退月（2026-11）が終わった12月の初めに、確定する（Cron）。
      await confirmEndedLeaves(db, g.groupId, NOW_DECEMBER);
      const rows = (await marks(g.groupId)).filter((row) => row.target_month === '2026-12');
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.member_changed_at), [NOW_DECEMBER, NOW_DECEMBER]);
    });

    it('アカウント削除で、翌月の行に印が付く', async () => {
      const g = await setup();
      await deleteAccount(db, g.people.alice.userId, NOW);
      const rows = (await marks(g.groupId)).filter((row) => row.target_month === '2026-12');
      assert.deepEqual(rows.map((row) => row.member_changed_at), [NOW, NOW]);
    });

    it('費目を作ったときに書く行には、印を付けない', async () => {
      const g = await setup();
      const created = await api.createCategory(g.people.alice, g.groupId, { name: '趣味', icon: 'game', color: 'red' });
      assert.equal(created.status, 201);
      const rows = await marks(g.groupId);
      assert.ok(rows.every((row) => row.member_changed_at === null));
    });
  });

  describe('印を消すとき', () => {
    it('割合を保存した費目だけ、印が消える（応答も null）。ほかの費目は残る', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const newcomer = await join(g);
      const ids = [alice.memberId, bob.memberId, newcomer];
      const put = await api.putRule(alice, g.groupId, '2026-11', g.categoryId, {
        shares: equalShares(ids).map(([memberId, basisPoints]) => ({ memberId, basisPoints })),
      });
      assert.equal(put.status, 200, JSON.stringify(put.body));
      assert.equal(put.body.rule.memberChangedAt, null);
      const got = await api.getRules(alice, g.groupId, '2026-11');
      assert.equal(rule(got.body, g.categoryId).memberChangedAt, null);
      assert.equal(rule(got.body, g.rentId).memberChangedAt, NOW);
    });

    it('見直しの確認で、印を一括で消す。割合は変えない。204で、バージョンが1上がる', async () => {
      const g = await setup();
      await join(g);
      const sharesBefore = (await api.getRules(g.people.alice, g.groupId, '2026-11')).body.categories;
      const version = await dataVersion(g.groupId);
      const result = await api.acknowledgeReset(g.people.bob, g.groupId, { month: '2026-11', through: NOW });
      assert.equal(result.status, 204);
      assert.equal(await dataVersion(g.groupId), version + 1);
      assert.ok((await marks(g.groupId)).every((row) => row.member_changed_at === null));
      const after = (await api.getRules(g.people.alice, g.groupId, '2026-11')).body.categories;
      assert.deepEqual(
        after.map(({ memberChangedAt: _, ...rest }: { memberChangedAt: number | null }) => rest),
        sharesBefore.map(({ memberChangedAt: _, ...rest }: { memberChangedAt: number | null }) => rest),
      );
      // もう一度送っても同じ（印が無いだけ）。
      assert.equal((await api.acknowledgeReset(g.people.bob, g.groupId, { month: '2026-11', through: NOW })).status, 204);
    });

    it('`through` より新しい印は消さない（確認を押すまでに、別のメンバーが参加して、割合を戻したもの）', async () => {
      const g = await setup();
      await join(g, 'first');
      // 確認を押す前に、別の参加があった（時刻は、アプリが見た印より新しい）。
      await db.prepare('UPDATE category_month_settings SET member_changed_at = ? WHERE group_id = ? AND target_month = ?')
        .bind(NOW + 1000, g.groupId, '2026-11')
        .run();
      assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: NOW })).status, 204);
      assert.ok((await marks(g.groupId)).filter((row) => row.target_month === '2026-11').every((row) => row.member_changed_at === NOW + 1000));
      assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: NOW + 1000 })).status, 204);
      assert.ok((await marks(g.groupId)).every((row) => row.member_changed_at === null));
    });

    describe('消す範囲は、見た月で使われている行だけ', () => {
      /** 2026-10（印なし）・2026-11・2026-12 の行を、全費目に置き、11月に印 `nov`、12月に印 `dec` を付ける（null なら付けない）。 */
      const withMarks = async (nov: number | null, dec: number | null) => {
        const g = await setup();
        const ids = [g.people.alice.memberId, g.people.bob.memberId];
        for (const categoryId of [g.categoryId, g.rentId]) {
          if (nov !== null) await insertCategoryRule(db, g.groupId, categoryId, '2026-11', equalShares(ids));
          if (dec !== null) await insertCategoryRule(db, g.groupId, categoryId, '2026-12', equalShares(ids));
        }
        const mark = (month: string, at: number | null) =>
          db
            .prepare('UPDATE category_month_settings SET member_changed_at = ? WHERE group_id = ? AND target_month = ?')
            .bind(at, g.groupId, month)
            .run();
        if (nov !== null) await mark('2026-11', nov);
        if (dec !== null) await mark('2026-12', dec);
        return g;
      };
      const byMonth = async (groupId: string) => {
        const rows = await marks(groupId);
        const out: Record<string, (number | null)[]> = {};
        for (const row of rows) (out[row.target_month] ??= []).push(row.member_changed_at);
        return out;
      };

      it('別の月の印は消さない（6月の印は、7月で確認しても、6月を開くまで残る）', async () => {
        const g = await withMarks(1000, 2000);
        assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-12', through: 2000 })).status, 204);
        assert.deepEqual(await byMonth(g.groupId), {
          '2026-10': [null, null],
          '2026-11': [1000, 1000],
          '2026-12': [null, null],
        });
        // 残った11月の印は、11月を開いたときに見えて、そこで確認すれば消える。
        const got = await api.getRules(g.people.alice, g.groupId, '2026-11');
        assert.deepEqual(got.body.categories.map((c: { memberChangedAt: number | null }) => c.memberChangedAt), [1000, 1000]);
        assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: 1000 })).status, 204);
        assert.deepEqual((await byMonth(g.groupId))['2026-11'], [null, null]);
      });

      it('後の月の行は消さない（確認した月より後に、別の印がある）', async () => {
        const g = await withMarks(1000, 2000);
        assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: 5000 })).status, 204);
        assert.deepEqual(await byMonth(g.groupId), {
          '2026-10': [null, null],
          '2026-11': [null, null],
          '2026-12': [2000, 2000],
        });
      });

      it('行が無い月で確認すると、その月が引き継いでいる前の月の行の印を消す', async () => {
        const g = await withMarks(1000, null);
        const seen = await api.getRules(g.people.alice, g.groupId, '2026-12');
        assert.deepEqual(seen.body.categories.map((c: { memberChangedAt: number | null }) => c.memberChangedAt), [1000, 1000]);
        assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-12', through: 1000 })).status, 204);
        assert.deepEqual((await byMonth(g.groupId))['2026-11'], [null, null]);
        const after = await api.getRules(g.people.alice, g.groupId, '2026-12');
        assert.deepEqual(after.body.categories.map((c: { memberChangedAt: number | null }) => c.memberChangedAt), [null, null]);
      });

      it('費目ごとに、その月で使われている行を消す（行が違う月の費目を、取り違えない）', async () => {
        const g = await withMarks(1000, null);
        // rent だけ、12月に自分の行（印つき）がある。food は 11月の行を引き継ぐ。
        const ids = [g.people.alice.memberId, g.people.bob.memberId];
        await insertCategoryRule(db, g.groupId, g.rentId, '2026-12', equalShares(ids));
        await db
          .prepare('UPDATE category_month_settings SET member_changed_at = 900 WHERE category_id = ? AND target_month = ?')
          .bind(g.rentId, '2026-12')
          .run();
        assert.equal((await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-12', through: 1000 })).status, 204);
        const rows = await marks(g.groupId);
        const at = (categoryId: string, month: string) =>
          rows.find((row) => row.category_id === categoryId && row.target_month === month)!.member_changed_at;
        assert.equal(at(g.categoryId, '2026-11'), null, 'food は11月の行を使っていたので消える');
        assert.equal(at(g.rentId, '2026-11'), 1000, 'rent は12月に自分の行があり、11月の行は使っていないので残る');
        assert.equal(at(g.rentId, '2026-12'), null);
      });
    });

    it('ほかのグループの印には触れない', async () => {
      const a = await setup();
      const b = await setup();
      await join(a);
      await join(b);
      assert.equal((await api.acknowledgeReset(a.people.alice, a.groupId, { month: '2026-11', through: NOW })).status, 204);
      assert.ok((await marks(b.groupId)).some((row) => row.member_changed_at === NOW));
    });

    it('入力の不備は400。メンバーでない人は404、セッション無しは401、参加前の月・脱退が確定した人は403', async () => {
      const g = await setup();
      for (const body of [
        {},
        { through: NOW },
        { month: '2026-11' },
        { month: '2026-13', through: NOW },
        { month: 'next', through: NOW },
        { month: '2026-11', through: -1 },
        { month: '2026-11', through: 1.5 },
        { month: '2026-11', through: '1' },
        { month: '2026-11', through: null },
        { month: '2026-11', through: NOW, extra: 1 },
      ]) {
        const result = await api.acknowledgeReset(g.people.alice, g.groupId, body);
        assert.equal(result.status, 400, JSON.stringify(body));
      }
      assert.equal((await api.acknowledgeReset(null, g.groupId, { month: '2026-11', through: NOW })).status, 401);
      const outsider = await factory.addUser('outsider');
      assert.deepEqual(await api.acknowledgeReset(outsider, g.groupId, { month: '2026-11', through: NOW }), { status: 404, body: { error: 'not_found' } });
      const f = await factory();
      assert.deepEqual(await api.acknowledgeReset(f.carol, f.groupId, { month: '2026-11', through: NOW }), { status: 403, body: { error: 'forbidden' } });
      // 参加（2026-11）より前の月は、割合を読めない月なので、確認もできない。
      assert.deepEqual(await api.acknowledgeReset(f.newbie, f.groupId, { month: '2026-10', through: NOW }), { status: 403, body: { error: 'forbidden' } });
      assert.equal((await marks(g.groupId)).length, 2);
    });

    it('読んだあとに別の書き込みが入れば、1回やり直す。続けて入れば409', async () => {
      const g = await setup();
      await join(g);
      const bump = () =>
        db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(g.groupId).run();
      const once = await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: NOW }, { env: interferingEnv(env, bump, { times: 1 }) });
      assert.equal(once.status, 204);
      await join(g, 'second');
      const twice = await api.acknowledgeReset(g.people.alice, g.groupId, { month: '2026-11', through: NOW_DECEMBER }, { env: interferingEnv(env, bump, { times: 2 }) });
      assert.deepEqual(twice, { status: 409, body: { error: 'conflict' } });
      assert.ok((await marks(g.groupId)).some((row) => row.member_changed_at !== null), '消えていない');
    });

    it('ルーティング: 入口から呼べる。POST 以外は405', async () => {
      const g = await setup();
      await join(g);
      const path = `/groups/${g.groupId}/category-shares/acknowledge-reset`;
      assert.equal((await read(await worker.fetch(request('POST', path, g.people.alice.token, { month: '2026-11', through: NOW }), env))).status, 204);
      assert.equal((await read(await worker.fetch(request('GET', path, g.people.alice.token), env))).status, 405);
      assert.equal((await read(await worker.fetch(request('POST', '/groups/bad id/category-shares/acknowledge-reset', g.people.alice.token, { month: '2026-11', through: NOW }), env))).status, 404);
    });
  });

  describe('月締め', () => {
    it('引き継いで書く行にも、印を写す（月を締めただけで、見直していないお知らせが消えない）', async () => {
      const g = await setup();
      // 2026-10 の food の行にだけ印がある（参加などで戻したあと）。2026-11 には行が無い。
      await db
        .prepare('UPDATE category_month_settings SET member_changed_at = ? WHERE group_id = ? AND category_id = ?')
        .bind(NOW - 5000, g.groupId, g.categoryId)
        .run();
      await insertExpenseRow(db, {
        groupId: g.groupId,
        categoryId: g.categoryId,
        payerMemberId: g.people.alice.memberId,
        amountMinor: 1000,
        targetMonth: '2026-11',
      });
      const closed = await monthApi(env).close(g.people.alice, g.groupId, '2026-11');
      assert.equal(closed.status, 201, JSON.stringify(closed.body));
      const november = new Map(
        (await marks(g.groupId)).filter((row) => row.target_month === '2026-11').map((row) => [row.category_id, row.member_changed_at]),
      );
      assert.equal(november.get(g.categoryId), NOW - 5000);
      assert.equal(november.get(g.rentId), null);
    });
  });
});
