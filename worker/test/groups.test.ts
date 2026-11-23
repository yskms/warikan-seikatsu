/// <reference types="node" />
// グループのAPI（src/groups.ts）の検査。規則は docs/backend-design.md 5章・9章「グループ・メンバー・招待」。
// ローカルD1（miniflare）での検査なので、確かめるのはロジック。競合は「読んだあとに別の書き込みが入った」状況で
// 再現して確かめている（本番D1での確認は13章の9）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { handleCreateExpense } from '../src/expenses.ts';
import { DEFAULT_CATEGORIES } from '../src/groups.ts';
import worker from '../src/index.ts';
import { MAX_MEMBERS_PER_GROUP } from '../src/limits.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertExpenseRow,
  insertRecurringRow,
  NOW,
  type Fixture,
} from './apiFixture.ts';
import { groupsApi } from './groupsApi.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { countingEnv, interferingEnv, monthApi, read, request } from './monthApi.ts';

const VALID = { name: 'ふたりの生活費', displayName: 'あきら', timezone: 'Asia/Tokyo' };
const uuid = () => crypto.randomUUID();

describe('グループのAPI', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let api: ReturnType<typeof groupsApi>;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
    factory = createFixtureFactory(db);
    api = groupsApi(env);
  });
  after(async () => {
    await local.dispose();
  });

  const all = async <T = Record<string, unknown>>(sql: string, ...binds: unknown[]) =>
    (await db.prepare(sql).bind(...binds).all<T>()).results;
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;

  // --- 作成 -------------------------------------------------------------------------------------

  describe('POST /groups', () => {
    it('グループ・自分のメンバー・初期の費目と、作った月の割合（自分100%）を作る', async () => {
      const user = await factory.addUser('creator');
      const result = await api.createGroup(user, { ...VALID, name: '  ふたりの生活費 ', displayName: ' あきら ' });
      assert.equal(result.status, 201);
      const group = result.body.group;
      assert.equal(group.name, 'ふたりの生活費');
      assert.equal(group.currencyCode, 'JPY');
      assert.equal(group.currencyMinorUnit, 0);
      assert.equal(group.timezone, 'Asia/Tokyo');
      assert.equal(group.createdAt, NOW);
      assert.equal(group.currencyLocked, false);
      assert.deepEqual([group.seatedMembers, group.maxMembers, group.canInvite], [1, MAX_MEMBERS_PER_GROUP, true]);
      assert.equal(group.members.length, 1);
      assert.equal(group.members[0].displayName, 'あきら');
      assert.equal(group.members[0].status, 'active');
      assert.equal(group.members[0].historyFromMonth, '2026-11');
      assert.equal(group.members[0].isMe, true);
      assert.equal(group.members[0].id, group.memberId);
      assert.equal('userId' in group.members[0] || 'user_id' in group.members[0], false);

      const categories = await all<{ id: string; name: string; icon: string; sort_order: number; archived_at: number | null }>(
        'SELECT id, name, icon, sort_order, archived_at FROM categories WHERE group_id = ? ORDER BY sort_order',
        group.id,
      );
      assert.deepEqual(
        categories.map((row) => row.name),
        DEFAULT_CATEGORIES.map((category) => category.name),
      );
      assert.deepEqual(
        categories.map((row) => row.sort_order),
        [0, 1, 2, 3, 4, 5, 6],
      );
      assert.ok(categories.every((row) => row.archived_at === null));
      // 費目ごとに、作った月の設定（上限額なし）と、作った人100%の割合が1組ずつ。
      const settings = await all('SELECT category_id, target_month, cap_member_id FROM category_month_settings WHERE group_id = ?', group.id);
      assert.equal(settings.length, 7);
      assert.ok(settings.every((row) => row.target_month === '2026-11' && row.cap_member_id === null));
      const shares = await all<{ member_id: string; share_basis_points: number }>(
        'SELECT member_id, share_basis_points FROM category_month_shares WHERE group_id = ?',
        group.id,
      );
      assert.equal(shares.length, 7);
      assert.ok(shares.every((row) => row.member_id === group.memberId && row.share_basis_points === 10000));
    });

    it('D1のクエリ数: 認証1 + 作成の文5 + 作成後の読み込み3(batchの文を1つずつ数える。Freeは1回の呼び出しにつき50まで)', async () => {
      const user = await factory.addUser('counting');
      const counting = countingEnv(env);
      const result = await api.createGroup(user, VALID, { env: counting.env });
      assert.equal(result.status, 201);
      // 書き込みの batch は1回(グループ・メンバー・費目・設定・割合の5文)。作成後に、グループ・メンバー・通貨固定の3文を読む。
      assert.deepEqual(counting.counts.batchSizes, [5, 3]);
      assert.equal(counting.counts.queries, 9);
    });

    it('通貨の小数桁数はサーバーが決める（USD 2、KRW 0）', async () => {
      const user = await factory.addUser('currency');
      const usd = await api.createGroup(user, { ...VALID, currencyCode: 'USD' });
      assert.equal(usd.status, 201);
      assert.equal(usd.body.group.currencyCode, 'USD');
      assert.equal(usd.body.group.currencyMinorUnit, 2);
      const krw = await api.createGroup(user, { ...VALID, currencyCode: 'KRW' });
      assert.equal(krw.body.group.currencyMinorUnit, 0);
      // 通貨の小数桁数は、クライアントの申告を受け付けない（知らない項目）。
      const sent = await api.createGroup(user, { ...VALID, currencyCode: 'USD', currencyMinorUnit: 0 });
      assert.deepEqual(sent, { status: 400, body: { error: 'invalid_request', field: 'currencyMinorUnit' } });
    });

    it('作った月は、グループのタイムゾーンで決める', async () => {
      const user = await factory.addUser('zone');
      // 2026-11-30 20:00 UTC は、東京では 12月1日、ロサンゼルスでは 11月30日。
      const boundary = Date.UTC(2026, 10, 30, 20, 0, 0);
      const tokyo = await api.createGroup(user, VALID, { now: boundary });
      assert.equal(tokyo.body.group.members[0].historyFromMonth, '2026-12');
      const la = await api.createGroup(user, { ...VALID, timezone: 'America/Los_Angeles' }, { now: boundary });
      assert.equal(la.body.group.members[0].historyFromMonth, '2026-11');
      const months = await all<{ target_month: string }>(
        'SELECT DISTINCT target_month FROM category_month_settings WHERE group_id = ?',
        la.body.group.id,
      );
      assert.deepEqual(months.map((row) => row.target_month), ['2026-11']);
    });

    it('入力の不備は400で、直す項目を返す', async () => {
      const user = await factory.addUser('invalid');
      const cases: [unknown, string | undefined][] = [
        [{ ...VALID, name: undefined }, 'name'],
        [{ ...VALID, name: '   ' }, 'name'],
        [{ ...VALID, name: 'あ'.repeat(31) }, 'name'],
        [{ ...VALID, name: 'a\nb' }, 'name'],
        [{ ...VALID, name: 123 }, 'name'],
        [{ ...VALID, displayName: undefined }, 'displayName'],
        [{ ...VALID, displayName: 'あ'.repeat(21) }, 'displayName'],
        [{ ...VALID, currencyCode: 'KWD' }, 'currencyCode'],
        [{ ...VALID, currencyCode: 'jpy' }, 'currencyCode'],
        [{ ...VALID, currencyCode: 'toString' }, 'currencyCode'],
        [{ ...VALID, timezone: undefined }, 'timezone'],
        [{ ...VALID, timezone: '+09:00' }, 'timezone'],
        [{ ...VALID, timezone: 'Mars/Olympus_Mons' }, 'timezone'],
        [{ ...VALID, id: 'not-a-uuid' }, 'id'],
        [{ ...VALID, id: uuid().toUpperCase() }, 'id'],
        [{ ...VALID, extra: 1 }, 'extra'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(await api.createGroup(user, body), { status: 400, body: { error: 'invalid_request', field } }, JSON.stringify(body));
      }
      // 30文字ちょうど・20文字ちょうどは通る。
      const edge = await api.createGroup(user, { ...VALID, name: 'あ'.repeat(30), displayName: '😀'.repeat(20) });
      assert.equal(edge.status, 201);
      assert.equal(await dataVersion(edge.body.group.id), 0);
    });

    it('セッションが無ければ401、本文がJSONでなければ400', async () => {
      assert.equal((await api.createGroup(null, VALID)).status, 401);
      const user = await factory.addUser('notjson');
      const broken = await worker.fetch(
        new Request('https://example.test/groups', {
          method: 'POST',
          headers: { authorization: `Bearer ${user.token}` },
          body: '{',
        }),
        env,
      );
      assert.equal(broken.status, 400);
    });

    it('同じ id の再送は、グループを増やさず、保存済みのグループを200で返す', async () => {
      const user = await factory.addUser('retry');
      const id = uuid();
      const first = await api.createGroup(user, { ...VALID, id });
      assert.equal(first.status, 201);
      assert.equal(first.body.group.id, id);
      const second = await api.createGroup(user, { ...VALID, id, name: '別の名前' });
      assert.equal(second.status, 200);
      assert.equal(second.body.group.name, VALID.name); // 送られた内容は見比べない
      assert.deepEqual((await all('SELECT id FROM expense_groups WHERE id = ?', id)).length, 1);
      assert.equal((await all('SELECT id FROM categories WHERE group_id = ?', id)).length, 7);
      assert.equal((await all('SELECT id FROM group_members WHERE group_id = ?', id)).length, 1);
    });

    it('他の人が使っている id は、中身を返さず409にし、何も書かない', async () => {
      const owner = await factory.addUser('owner');
      const other = await factory.addUser('other');
      const id = uuid();
      assert.equal((await api.createGroup(owner, { ...VALID, id })).status, 201);
      const clash = await api.createGroup(other, { ...VALID, id });
      assert.deepEqual(clash, { status: 409, body: { error: 'conflict' } });
      assert.equal((await all('SELECT id FROM group_members WHERE group_id = ?', id)).length, 1);
      assert.equal((await api.listGroups(other)).body.groups.length, 0);
    });

    it('同じ id で同時に作っても、グループは1つだけ', async () => {
      const user = await factory.addUser('race');
      const id = uuid();
      const [a, b] = await Promise.all([api.createGroup(user, { ...VALID, id }), api.createGroup(user, { ...VALID, id })]);
      assert.deepEqual([a.status, b.status].sort(), [200, 201]);
      assert.equal((await all('SELECT id FROM expense_groups WHERE id = ?', id)).length, 1);
      assert.equal((await all('SELECT id FROM categories WHERE group_id = ?', id)).length, 7);
    });

    it('1人が複数のグループを作れる', async () => {
      const user = await factory.addUser('many');
      await api.createGroup(user, VALID, { now: NOW });
      await api.createGroup(user, { ...VALID, name: 'ルームシェア' }, { now: NOW + 1000 });
      const list = await api.listGroups(user);
      assert.deepEqual(
        list.body.groups.map((group: { name: string }) => group.name),
        ['ふたりの生活費', 'ルームシェア'],
      );
    });

    it('作ったあとすぐ、費目の割合で支出を登録・集計できる（初期の費目の割合が、集計に使える形）', async () => {
      const user = await factory.addUser('flow');
      const created = await api.createGroup(user, VALID);
      const groupId = created.body.group.id as string;
      const memberId = created.body.group.memberId as string;
      const category = await db.prepare('SELECT id FROM categories WHERE group_id = ? ORDER BY sort_order LIMIT 1').bind(groupId).first<{ id: string }>();
      const registered = await read(
        await handleCreateExpense(
          request('POST', `/groups/${groupId}/expenses`, user.token, {
            expenseDate: '2026-11-19',
            targetMonth: '2026-11',
            amountMinor: 80000,
            categoryId: category!.id,
            payerMemberId: memberId,
            split: { method: 'category' },
          }),
          env,
          NOW,
          groupId,
        ),
      );
      assert.equal(registered.status, 201);
      const summary = await monthApi(env).summary({ userId: user.userId, token: user.token, memberId }, groupId, '2026-11');
      assert.equal(summary.status, 200);
      assert.equal(summary.body.totalMinor, 80000);
      assert.deepEqual(summary.body.members.map((m: { burdenMinor: number }) => m.burdenMinor), [80000]);
    });

    it('相手が参加すると、初期の費目の割合が均等になる（5章）', async () => {
      const user = await factory.addUser('inviter');
      const created = await api.createGroup(user, VALID);
      const groupId = created.body.group.id as string;
      const person = { userId: user.userId, token: user.token, memberId: created.body.group.memberId as string };
      const invites = membershipApi(env);
      const invite = await invites.createInvite(person, groupId);
      const partner = await factory.addUser('partner');
      const joined = await invites.join(partner, invite.body.invite.token, { displayName: 'ゆうき' });
      assert.equal(joined.status, 201);
      const shares = await all<{ share_basis_points: number }>(
        'SELECT share_basis_points FROM category_month_shares WHERE group_id = ? AND target_month = ?',
        groupId,
        '2026-11',
      );
      assert.equal(shares.length, 14);
      assert.ok(shares.every((row) => row.share_basis_points === 5000));
      // 参加した人の色は、作った人と重ならない。
      const colors = await all<{ color: string }>('SELECT color FROM group_members WHERE group_id = ?', groupId);
      assert.equal(new Set(colors.map((row) => row.color)).size, 2);
    });
  });

  // --- 一覧・詳細 -------------------------------------------------------------------------------

  describe('GET /groups, GET /groups/:id', () => {
    let f: Fixture;
    before(async () => {
      f = await factory();
    });

    it('一覧は、自分がデータを扱えるグループだけ（脱退済みは出ない）', async () => {
      const alice = await api.listGroups(f.alice);
      assert.equal(alice.status, 200);
      assert.deepEqual(alice.body.groups.map((g: { id: string }) => g.id), [f.groupId]);
      assert.equal(alice.body.groups[0].memberId, f.alice.memberId);
      assert.equal(alice.body.groups[0].memberStatus, 'active');
      assert.equal(alice.body.groups[0].historyFromMonth, '2026-10');
      // 脱退が確定した（leaving）人は、精算が終わるまで見られる。
      const carol = await api.listGroups(f.carol);
      assert.equal(carol.body.groups[0].memberStatus, 'leaving');
      assert.equal(carol.body.groups[0].expenseEndMonth, '2026-11');
      assert.deepEqual((await api.listGroups(f.erin)).body.groups, []);
      assert.deepEqual((await api.listGroups(f.outsider)).body.groups, []);
      assert.equal((await api.listGroups(null)).status, 401);
    });

    it('詳細は、メンバー全員（脱退済み・削除済みを含む）を返し、ユーザーのIDは返さない', async () => {
      const result = await api.getGroup(f.alice, f.groupId);
      assert.equal(result.status, 200);
      const group = result.body.group;
      assert.equal(group.id, f.groupId);
      assert.equal(group.memberId, f.alice.memberId);
      assert.deepEqual(group.members.map((m: { displayName: string }) => m.displayName), ['alice', 'bob', 'carol', 'dave', 'erin', 'newbie']);
      const byName = Object.fromEntries(group.members.map((m: { displayName: string }) => [m.displayName, m]));
      assert.equal(byName.alice.isMe, true);
      assert.equal(byName.bob.isMe, false);
      assert.equal(byName.carol.status, 'leaving');
      assert.equal(byName.dave.status, 'deleted');
      assert.equal(byName.erin.status, 'left');
      assert.equal(byName.newbie.historyFromMonth, '2026-11');
      assert.ok(!JSON.stringify(group).includes(f.alice.userId));
      assert.equal(group.currencyLocked, false);
    });

    it('人数の上限: 数える人数・上限・いま招待できるか（canInvite）を返す。脱退が確定した人・脱退済み・削除済みは数えない', async () => {
      // f の参加中は alice・bob・newbie の3人。carol は脱退が確定、dave は削除済み、erin は脱退済み。
      const group = (await api.getGroup(f.alice, f.groupId)).body.group;
      assert.deepEqual([group.seatedMembers, group.maxMembers, group.canInvite], [3, MAX_MEMBERS_PER_GROUP, true]);
      // 脱退が確定した人は、人数が空いていても、招待を発行できない。
      const carol = (await api.getGroup(f.carol, f.groupId)).body.group;
      assert.deepEqual([carol.seatedMembers, carol.canInvite], [3, false]);
    });

    it('人数の上限: 満員なら canInvite は false。脱退月が終わった人（Cronの確定の前）は数えず、その人自身も false', async () => {
      const g = await factory.createGroup(['alice', 'bob', 'carol', 'dave', 'erin']);
      const full = (await api.getGroup(g.people.alice, g.groupId)).body.group;
      assert.deepEqual([full.seatedMembers, full.canInvite], [MAX_MEMBERS_PER_GROUP, false]);
      // 脱退月（2026-10）が終わった。status は active のまま（Cronが確定するまで）。
      await db.prepare(`UPDATE group_members SET leave_requested_month = '2026-10', expense_end_month = '2026-10' WHERE id = ?`).bind(g.people.erin.memberId).run();
      const alice = (await api.getGroup(g.people.alice, g.groupId)).body.group;
      assert.deepEqual([alice.seatedMembers, alice.canInvite], [MAX_MEMBERS_PER_GROUP - 1, true]);
      const erin = (await api.getGroup(g.people.erin, g.groupId)).body.group;
      assert.deepEqual([erin.seatedMembers, erin.canInvite], [MAX_MEMBERS_PER_GROUP - 1, false]);
    });

    it('メンバーでない人・脱退済みの人・他のグループの人は、区別せず404', async () => {
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.deepEqual(await api.getGroup(who, f.groupId), { status: 404, body: { error: 'not_found' } });
      }
      assert.deepEqual(await api.getGroup(f.alice, 'no-such-group'), { status: 404, body: { error: 'not_found' } });
      assert.equal((await api.getGroup(null, f.groupId)).status, 401);
    });

    it('ルーティング: 入口から、作成・一覧・詳細・変更が呼べる', async () => {
      const user = await factory.addUser('routed');
      const created = await read(await worker.fetch(request('POST', '/groups', user.token, VALID), env));
      assert.equal(created.status, 201);
      const id = created.body.group.id;
      assert.equal((await read(await worker.fetch(request('GET', '/groups', user.token), env))).body.groups.length, 1);
      assert.equal((await read(await worker.fetch(request('GET', `/groups/${id}`, user.token), env))).status, 200);
      assert.equal((await read(await worker.fetch(request('PATCH', `/groups/${id}`, user.token, { name: '改名' }), env))).body.group.name, '改名');
      assert.equal((await read(await worker.fetch(request('PATCH', `/groups/${id}/members/me`, user.token, { color: 'red' }), env))).status, 200);
      assert.equal((await read(await worker.fetch(request('DELETE', `/groups/${id}`, user.token), env))).status, 405);
      assert.equal((await read(await worker.fetch(request('GET', '/groups/bad id', user.token), env))).status, 404);
    });
  });

  // --- 変更 -------------------------------------------------------------------------------------

  describe('PATCH /groups/:id', () => {
    it('グループ名を変える（バージョンが上がる）', async () => {
      const f = await factory();
      const before = await dataVersion(f.groupId);
      const result = await api.updateGroup(f.bob, f.groupId, { name: '  新しい名前  ' });
      assert.equal(result.status, 200);
      assert.equal(result.body.group.name, '新しい名前');
      assert.equal(await dataVersion(f.groupId), before + 1);
    });

    it('支出などが無ければ、通貨を変えられる（小数桁数も変わる）', async () => {
      const f = await factory();
      const result = await api.updateGroup(f.alice, f.groupId, { currencyCode: 'USD' });
      assert.equal(result.status, 200);
      assert.equal(result.body.group.currencyCode, 'USD');
      assert.equal(result.body.group.currencyMinorUnit, 2);
      const back = await api.updateGroup(f.alice, f.groupId, { name: 'x', currencyCode: 'JPY' });
      assert.equal(back.body.group.currencyMinorUnit, 0);
    });

    it('変わるものが無ければ、書かずに現在のグループを返す(バージョンを上げない)', async () => {
      const f = await factory();
      const before = await dataVersion(f.groupId);
      const same = await api.updateGroup(f.alice, f.groupId, { name: ' ふたりの生活費 ', currencyCode: 'JPY' });
      assert.equal(same.status, 200);
      assert.equal(same.body.group.name, 'ふたりの生活費');
      assert.equal(await dataVersion(f.groupId), before);
      assert.equal((await api.updateGroup(f.alice, f.groupId, { name: '改名' })).status, 200);
      assert.equal(await dataVersion(f.groupId), before + 1);
    });

    it('金額に関わるものがあれば、通貨は変えられない（支出・固定費・上限額・締めた月）。名前は変えられる', async () => {
      const lockers: [string, (f: Fixture) => Promise<void>][] = [
        ['支出', async (f) => void (await insertExpenseRow(db, { groupId: f.groupId, categoryId: f.categoryId, payerMemberId: f.alice.memberId, amountMinor: 100, targetMonth: '2026-10' }))],
        ['固定費', async (f) => void (await insertRecurringRow(db, { groupId: f.groupId, categoryId: f.categoryId, payerMemberId: f.alice.memberId }))],
        [
          '上限額',
          async (f) =>
            insertCategoryRule(db, f.groupId, f.categoryId, '2026-10', equalShares([f.alice.memberId, f.bob.memberId]), {
              memberId: f.alice.memberId,
              capMinor: 10000,
            }),
        ],
        ['締めた月', async (f) => insertClosing(db, f.groupId, '2026-10', f.alice.memberId)],
      ];
      for (const [label, lock] of lockers) {
        const f = await factory();
        const unlocked = await api.getGroup(f.alice, f.groupId);
        assert.equal(unlocked.body.group.currencyLocked, false, label);
        await lock(f);
        const locked = await api.getGroup(f.alice, f.groupId);
        assert.equal(locked.body.group.currencyLocked, true, label);
        assert.deepEqual(await api.updateGroup(f.alice, f.groupId, { currencyCode: 'USD' }), { status: 409, body: { error: 'currency_locked' } }, label);
        assert.equal((await all('SELECT currency_code FROM expense_groups WHERE id = ?', f.groupId))[0]!.currency_code, 'JPY', label);
        // いまと同じ通貨を送る・名前だけ変えるのは、固定されていても通る。
        assert.equal((await api.updateGroup(f.alice, f.groupId, { currencyCode: 'JPY', name: '改名' })).status, 200, label);
      }
    });

    it('入力の不備は400', async () => {
      const f = await factory();
      const cases: [unknown, string | undefined][] = [
        [{}, undefined],
        [{ name: '' }, 'name'],
        [{ name: 'あ'.repeat(31) }, 'name'],
        [{ currencyCode: 'KWD' }, 'currencyCode'],
        [{ timezone: 'Asia/Tokyo' }, 'timezone'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(
          await api.updateGroup(f.alice, f.groupId, body),
          { status: 400, body: field === undefined ? { error: 'invalid_request' } : { error: 'invalid_request', field } },
          JSON.stringify(body),
        );
      }
    });

    it('脱退が確定したメンバーは変えられない(403)。メンバーでない人は404', async () => {
      const f = await factory();
      assert.deepEqual(await api.updateGroup(f.carol, f.groupId, { name: 'x' }), { status: 403, body: { error: 'forbidden' } });
      for (const who of [f.outsider, f.erin, f.other.member, null]) {
        const result = await api.updateGroup(who, f.groupId, { name: 'x' });
        assert.equal(result.status, who === null ? 401 : 404);
      }
      assert.equal((await all('SELECT name FROM expense_groups WHERE id = ?', f.groupId))[0]!.name, 'ふたりの生活費');
    });

    it('読んだあとに別の書き込みが入れば、1回やり直して書ける。続けて入れば409', async () => {
      const f = await factory();
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(f.groupId).run();
      const once = await api.updateGroup(f.alice, f.groupId, { name: '一度競合' }, { env: interferingEnv(env, bump, { times: 1 }) });
      assert.equal(once.status, 200);
      assert.equal(once.body.group.name, '一度競合');
      const twice = await api.updateGroup(f.alice, f.groupId, { name: '二度競合' }, { env: interferingEnv(env, bump, { times: 2 }) });
      assert.deepEqual(twice, { status: 409, body: { error: 'conflict' } });
      assert.equal((await all('SELECT name FROM expense_groups WHERE id = ?', f.groupId))[0]!.name, '一度競合');
    });

    it('通貨の検査のあとに支出が入れば、競合として検出され、通貨は変わらない', async () => {
      const f = await factory();
      const addExpense = () =>
        insertExpenseRow(db, { groupId: f.groupId, categoryId: f.categoryId, payerMemberId: f.alice.memberId, amountMinor: 100, targetMonth: '2026-10' }).then(() =>
          db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(f.groupId).run(),
        );
      const result = await api.updateGroup(f.alice, f.groupId, { currencyCode: 'USD' }, { env: interferingEnv(env, addExpense, { times: 1 }) });
      // やり直した検証で、通貨が固定されたものとして断られる。
      assert.deepEqual(result, { status: 409, body: { error: 'currency_locked' } });
      assert.equal((await all('SELECT currency_code FROM expense_groups WHERE id = ?', f.groupId))[0]!.currency_code, 'JPY');
    });
  });

  // --- 自分の名前と色 ----------------------------------------------------------------------------

  describe('PATCH /groups/:id/members/me', () => {
    it('自分の表示名と色を変える。他のメンバーは変わらない', async () => {
      const f = await factory();
      const result = await api.updateMe(f.alice, f.groupId, { displayName: ' あきら ', color: 'purple' });
      assert.equal(result.status, 200);
      const me = result.body.group.members.find((m: { isMe: boolean }) => m.isMe);
      assert.equal(me.displayName, 'あきら');
      assert.equal(me.color, 'purple');
      const bob = result.body.group.members.find((m: { id: string }) => m.id === f.bob.memberId);
      assert.equal(bob.displayName, 'bob');
      assert.equal(bob.color, 'pink');
      // 片方だけ変える。
      const nameOnly = await api.updateMe(f.alice, f.groupId, { color: 'teal' });
      assert.equal(nameOnly.body.group.members.find((m: { isMe: boolean }) => m.isMe).displayName, 'あきら');
    });

    it('変わるものが無ければ、書かずに現在の状態を返す(バージョンを上げない)', async () => {
      const f = await factory();
      const before = await dataVersion(f.groupId);
      const same = await api.updateMe(f.alice, f.groupId, { displayName: ' alice ', color: 'pink' });
      assert.equal(same.status, 200);
      assert.equal(await dataVersion(f.groupId), before);
      assert.equal((await api.updateMe(f.alice, f.groupId, { color: 'red' })).status, 200);
      assert.equal(await dataVersion(f.groupId), before + 1);
    });

    it('入力の不備は400（色は一覧にあるものだけ）', async () => {
      const f = await factory();
      const cases: [unknown, string | undefined][] = [
        [{}, undefined],
        [{ displayName: '' }, 'displayName'],
        [{ displayName: 'あ'.repeat(21) }, 'displayName'],
        [{ color: 'magenta' }, 'color'],
        [{ color: 1 }, 'color'],
        [{ status: 'left' }, 'status'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(
          await api.updateMe(f.alice, f.groupId, body),
          { status: 400, body: field === undefined ? { error: 'invalid_request' } : { error: 'invalid_request', field } },
          JSON.stringify(body),
        );
      }
    });

    it('脱退が確定したメンバー(leaving)も、自分の名前は直せる。メンバーでない人は404', async () => {
      const f = await factory();
      assert.equal((await api.updateMe(f.carol, f.groupId, { displayName: 'キャロル' })).status, 200);
      assert.equal((await all('SELECT display_name FROM group_members WHERE id = ?', f.carol.memberId))[0]!.display_name, 'キャロル');
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.equal((await api.updateMe(who, f.groupId, { displayName: 'x' })).status, 404);
      }
    });

    it('締めた月の名前は変わらない（締めた時点の名前が残る）', async () => {
      const g = await factory.createGroup(['alice', 'bob']);
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([g.people.alice.memberId, g.people.bob.memberId]));
      await insertExpenseRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, amountMinor: 1000, targetMonth: '2026-10' });
      const months = monthApi(env);
      assert.equal((await months.close(g.people.alice, g.groupId, '2026-10')).status, 201);
      await api.updateMe(g.people.alice, g.groupId, { displayName: '改名後' });
      const closing = await months.closing(g.people.bob, g.groupId, '2026-10');
      assert.equal(closing.body.members.find((m: { memberId: string }) => m.memberId === g.people.alice.memberId).displayName, 'alice');
    });
  });
});
