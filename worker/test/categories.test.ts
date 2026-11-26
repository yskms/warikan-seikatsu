/// <reference types="node" />
// 費目と、月ごとの負担割合のAPI（src/categories.ts）の検査。規則は docs/backend-design.md 3章「月ごとの負担割合」・
// 8章、形は9章「費目・負担割合・支出・固定費」。ローカルD1（miniflare）での検査なので、確かめるのはロジック。競合は
// 「読んだあとに別の書き込みが入った」状況で再現して確かめている（本番D1での確認は13章の9）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { handleCreateExpense } from '../src/expenses.ts';
import worker from '../src/index.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  NOW,
  type Fixture,
  type Person,
  type SimpleGroup,
} from './apiFixture.ts';
import { groupsApi } from './groupsApi.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { interferingEnv, monthApi, NOW_DECEMBER, read, request } from './monthApi.ts';

const uuid = () => crypto.randomUUID();
const NEW_CATEGORY = { name: '趣味', icon: 'game', color: 'red' };

describe('費目と月ごとの負担割合のAPI', () => {
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
  const bumpVersion = (groupId: string) => () =>
    db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(groupId).run();
  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  /** その費目の、その月の割合（メンバーIDの昇順）。 */
  const sharesOf = async (categoryId: string, month: string) =>
    (
      await all<{ member_id: string; share_basis_points: number }>(
        'SELECT member_id, share_basis_points FROM category_month_shares WHERE category_id = ? AND target_month = ? ORDER BY member_id',
        categoryId,
        month,
      )
    ).map((row) => [row.member_id, row.share_basis_points] as const);
  const ruleMonthsOf = async (categoryId: string) =>
    (
      await all<{ target_month: string }>(
        'SELECT target_month FROM category_month_settings WHERE category_id = ? ORDER BY target_month',
        categoryId,
      )
    ).map((row) => row.target_month);

  /** alice・bob（2026-10から）と、費目1つ。2026-10の割合は均等。 */
  const setup = async (): Promise<SimpleGroup<'alice' | 'bob'>> => {
    const group = await factory.createGroup(['alice', 'bob']);
    await insertCategoryRule(
      db,
      group.groupId,
      group.categoryId,
      '2026-10',
      equalShares([group.people.alice.memberId, group.people.bob.memberId]),
    );
    return group;
  };
  const registerExpense = async (group: SimpleGroup<'alice' | 'bob'>, who: Person, categoryId: string, amountMinor: number, targetMonth = '2026-10') =>
    read(
      await handleCreateExpense(
        request('POST', `/groups/${group.groupId}/expenses`, who.token, {
          expenseDate: `${targetMonth}-10`,
          targetMonth,
          amountMinor,
          categoryId,
          payerMemberId: who.memberId,
          split: { method: 'category' },
        }),
        env,
        NOW,
        group.groupId,
      ),
    );

  // --- 一覧 -------------------------------------------------------------------------------------

  describe('GET /groups/:id/categories', () => {
    it('並び順どおりに、アーカイブした費目も含めて返す', async () => {
      const f = await factory();
      const result = await api.listCategories(f.alice, f.groupId);
      assert.equal(result.status, 200);
      assert.deepEqual(
        result.body.categories.map((c: { name: string; archivedAt: number | null }) => [c.name, c.archivedAt !== null]),
        [
          ['food', false],
          ['old', true],
        ].sort(),
      );
      assert.deepEqual(Object.keys(result.body.categories[0]).sort(), ['archivedAt', 'color', 'icon', 'id', 'name', 'sortOrder']);
    });

    it('脱退が確定したメンバー(leaving)も読める。メンバーでない人は404、セッション無しは401', async () => {
      const f = await factory();
      assert.equal((await api.listCategories(f.carol, f.groupId)).status, 200);
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.deepEqual(await api.listCategories(who, f.groupId), { status: 404, body: { error: 'not_found' } });
      }
      assert.equal((await api.listCategories(null, f.groupId)).status, 401);
    });
  });

  // --- 作成 -------------------------------------------------------------------------------------

  describe('POST /groups/:id/categories', () => {
    it('費目を作り、最初の未締めの月に、その月のメンバーでの均等な割合を書く（上限額なし）', async () => {
      const g = await setup();
      const result = await api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, name: ' 趣味 ' });
      assert.equal(result.status, 201);
      const category = result.body.category;
      assert.equal(category.name, '趣味');
      assert.equal(category.icon, 'game');
      assert.equal(category.color, 'red');
      assert.equal(category.sortOrder, 1); // 既存の費目の次
      assert.equal(category.archivedAt, null);
      assert.deepEqual(await ruleMonthsOf(category.id), ['2026-10']);
      assert.deepEqual(await sharesOf(category.id, '2026-10'), equalShares([g.people.alice.memberId, g.people.bob.memberId]));
      const setting = await all<{ cap_member_id: string | null }>('SELECT cap_member_id FROM category_month_settings WHERE category_id = ?', category.id);
      assert.equal(setting[0]!.cap_member_id, null);
      assert.equal(await dataVersion(g.groupId), 1);
    });

    it('作った費目で、すぐ支出を登録して集計できる（月の設定と割合が書かれている）', async () => {
      const g = await setup();
      const created = await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY);
      const registered = await registerExpense(g, g.people.alice, created.body.category.id, 10001);
      assert.equal(registered.status, 201);
      const summary = await monthApi(env).summary(g.people.bob, g.groupId, '2026-10');
      assert.equal(summary.status, 200);
      assert.deepEqual(
        summary.body.members.map((m: { burdenMinor: number }) => m.burdenMinor),
        [5001, 5000],
      );
    });

    it('その月に参加している全員で書く（脱退・削除したメンバーも、その月までは含む）', async () => {
      const f = await factory();
      // 2026-10 の参加者: alice, bob, carol(2026-11まで), dave(削除。2026-10まで), erin(脱退済み。2026-10まで)。newbie は 2026-11 から。
      const result = await api.createCategory(f.alice, f.groupId, NEW_CATEGORY);
      const rows = await sharesOf(result.body.category.id, '2026-10');
      assert.equal(rows.length, 5);
      assert.equal(rows.reduce((sum, [, basisPoints]) => sum + basisPoints, 0), 10000);
      assert.ok(!rows.some(([memberId]) => memberId === f.newbie.memberId));
    });

    it('割合の行がある先の月にも、その月のメンバーでの行を書く（先の月が、古いメンバーを引き継がないように）', async () => {
      const g = await factory.createGroup(['alice', 'bob']);
      const carolId = await factory.addMember(g.groupId, 'carol', null, { status: 'deleted', expenseEndMonth: '2026-10' });
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([alice.memberId, bob.memberId, carolId]));
      // アカウント削除が、翌月の割合を、残るメンバーでの均等に書いた状態。
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', equalShares([alice.memberId, bob.memberId]));
      const result = await api.createCategory(alice, g.groupId, NEW_CATEGORY);
      const id = result.body.category.id as string;
      assert.deepEqual(await ruleMonthsOf(id), ['2026-10', '2026-11']);
      assert.equal((await sharesOf(id, '2026-10')).length, 3);
      assert.deepEqual(await sharesOf(id, '2026-11'), equalShares([alice.memberId, bob.memberId]));
      // 月ごとに見ても、先の月は2人。
      const rules = await api.getRules(alice, g.groupId, '2026-11');
      const created = rules.body.categories.find((c: { categoryId: string }) => c.categoryId === id);
      assert.equal(created.shares.length, 2);
    });

    it('月を締めたあとは、最初の未締めの月から書く（締めた月には書かない）', async () => {
      const g = await setup();
      await insertClosing(db, g.groupId, '2026-10', g.people.alice.memberId);
      const result = await api.createCategory(g.people.bob, g.groupId, NEW_CATEGORY);
      assert.equal(result.status, 201);
      assert.deepEqual(await ruleMonthsOf(result.body.category.id), ['2026-11']);
      // 締めた月には、この費目の割合は無い。
      const closedMonthRules = await api.getRules(g.people.alice, g.groupId, '2026-10');
      assert.ok(!closedMonthRules.body.categories.some((c: { categoryId: string }) => c.categoryId === result.body.category.id));
    });

    it('費目の数には上限がある（アーカイブした費目も数える）', async () => {
      const g = await setup();
      for (let i = 0; i < 28; i += 1) await factory.addCategory(g.groupId, `c${i}`, i % 2 === 0);
      assert.equal((await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY)).status, 201); // 30個目
      assert.deepEqual(await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY), {
        status: 409,
        body: { error: 'too_many_categories' },
      });
    });

    it('入力の不備は400で、直す項目を返す', async () => {
      const g = await setup();
      const cases: [unknown, string][] = [
        [{ ...NEW_CATEGORY, name: undefined }, 'name'],
        [{ ...NEW_CATEGORY, name: '  ' }, 'name'],
        [{ ...NEW_CATEGORY, name: 'あ'.repeat(21) }, 'name'],
        [{ ...NEW_CATEGORY, icon: undefined }, 'icon'],
        [{ ...NEW_CATEGORY, icon: 'Game' }, 'icon'],
        [{ ...NEW_CATEGORY, icon: 'a'.repeat(31) }, 'icon'],
        [{ ...NEW_CATEGORY, color: '' }, 'color'],
        [{ ...NEW_CATEGORY, id: 'x' }, 'id'],
        [{ ...NEW_CATEGORY, sortOrder: 3 }, 'sortOrder'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(await api.createCategory(g.people.alice, g.groupId, body), { status: 400, body: { error: 'invalid_request', field } }, JSON.stringify(body));
      }
      assert.equal((await all('SELECT id FROM categories WHERE group_id = ?', g.groupId)).length, 1);
    });

    it('同じ id の再送は、費目を増やさず保存済みの費目を返す。別のグループの id は409', async () => {
      const g = await setup();
      const other = await setup();
      const id = uuid();
      const first = await api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, id });
      assert.equal(first.status, 201);
      assert.equal(first.body.category.id, id);
      const again = await api.createCategory(g.people.bob, g.groupId, { ...NEW_CATEGORY, id, name: '別の名前' });
      assert.equal(again.status, 200);
      assert.equal(again.body.category.name, '趣味');
      assert.equal((await all('SELECT id FROM categories WHERE id = ?', id)).length, 1);
      assert.deepEqual(await api.createCategory(other.people.alice, other.groupId, { ...NEW_CATEGORY, id }), { status: 409, body: { error: 'conflict' } });
      assert.equal((await all('SELECT id FROM categories WHERE group_id = ?', other.groupId)).length, 1);
    });

    it('同じ id で同時に作っても、費目は1つだけで、どちらも成功する(競合した側は、読み直して保存済みの費目を返す)', async () => {
      const g = await setup();
      const id = uuid();
      const [a, b] = await Promise.all([
        api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, id }),
        api.createCategory(g.people.bob, g.groupId, { ...NEW_CATEGORY, id }),
      ]);
      assert.deepEqual([a.status, b.status].sort(), [200, 201]);
      assert.equal((await all('SELECT id FROM categories WHERE id = ?', id)).length, 1);
      assert.equal((await sharesOf(id, '2026-10')).length, 2);
    });

    it('脱退が確定したメンバー(leaving)は403、メンバーでない人は404、セッション無しは401', async () => {
      const f = await factory();
      assert.deepEqual(await api.createCategory(f.carol, f.groupId, NEW_CATEGORY), { status: 403, body: { error: 'forbidden' } });
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.deepEqual(await api.createCategory(who, f.groupId, NEW_CATEGORY), { status: 404, body: { error: 'not_found' } });
      }
      assert.equal((await api.createCategory(null, f.groupId, NEW_CATEGORY)).status, 401);
      assert.equal((await all('SELECT id FROM categories WHERE group_id = ?', f.groupId)).length, 2);
    });

    it('読んだあとに別の書き込みが入れば、1回やり直して書ける。続けて入れば409で、何も書かない', async () => {
      const g = await setup();
      const once = await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY, {
        env: interferingEnv(env, bumpVersion(g.groupId), { times: 1 }),
      });
      assert.equal(once.status, 201);
      const twice = await api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, name: '二度競合' }, {
        env: interferingEnv(env, bumpVersion(g.groupId), { times: 2 }),
      });
      assert.deepEqual(twice, { status: 409, body: { error: 'conflict' } });
      assert.deepEqual(
        (await all<{ name: string }>('SELECT name FROM categories WHERE group_id = ? ORDER BY sort_order', g.groupId)).map((row) => row.name),
        ['food', '趣味'],
      );
    });

    it('ルーティング: 入口から、一覧・作成・変更・並べ替えが呼べる', async () => {
      const g = await setup();
      const { alice } = g.people;
      const created = await read(await worker.fetch(request('POST', `/groups/${g.groupId}/categories`, alice.token, NEW_CATEGORY), env));
      assert.equal(created.status, 201);
      const id = created.body.category.id;
      assert.equal((await read(await worker.fetch(request('GET', `/groups/${g.groupId}/categories`, alice.token), env))).body.categories.length, 2);
      assert.equal((await read(await worker.fetch(request('PATCH', `/categories/${id}`, alice.token, { name: '改名' }), env))).body.category.name, '改名');
      const order = await read(
        await worker.fetch(request('PUT', `/groups/${g.groupId}/categories/order`, alice.token, { categoryIds: [id, g.categoryId] }), env),
      );
      assert.equal(order.status, 200);
      assert.equal((await read(await worker.fetch(request('DELETE', `/categories/${id}`, alice.token), env))).status, 405);
    });
  });

  // --- 変更・アーカイブ -------------------------------------------------------------------------

  describe('PATCH /categories/:id', () => {
    it('名前・アイコン・色を変える。送らなかった項目は変えない', async () => {
      const g = await setup();
      const result = await api.updateCategory(g.people.bob, g.categoryId, { name: ' 食料品 ', color: 'green' });
      assert.equal(result.status, 200);
      assert.deepEqual(
        [result.body.category.name, result.body.category.icon, result.body.category.color],
        ['食料品', 'cart', 'green'],
      );
      assert.equal(await dataVersion(g.groupId), 1);
    });

    it('変わるものが無ければ、書かずに現在の費目を返す(バージョンを上げない)', async () => {
      const g = await setup();
      const before = await dataVersion(g.groupId);
      const same = await api.updateCategory(g.people.alice, g.categoryId, { name: ' food ', icon: 'cart', color: 'blue', archived: false });
      assert.equal(same.status, 200);
      assert.equal(same.body.category.name, 'food');
      assert.equal(await dataVersion(g.groupId), before);
      // 1つでも変われば書く。
      await api.updateCategory(g.people.alice, g.categoryId, { color: 'red' });
      assert.equal(await dataVersion(g.groupId), before + 1);
    });

    it('アーカイブすると新しい支出で選べなくなり、戻すと選べる。過去の支出と割合は残る', async () => {
      const g = await setup();
      const first = await registerExpense(g, g.people.alice, g.categoryId, 1000);
      assert.equal(first.status, 201);
      const archived = await api.updateCategory(g.people.alice, g.categoryId, { archived: true });
      assert.equal(archived.body.category.archivedAt, NOW);
      assert.deepEqual(await registerExpense(g, g.people.alice, g.categoryId, 1000), { status: 409, body: { error: 'category_not_available' } });
      // もう一度アーカイブしても、日時は最初のまま。
      const again = await api.updateCategory(g.people.alice, g.categoryId, { archived: true }, { now: NOW + 5000 });
      assert.equal(again.body.category.archivedAt, NOW);
      // 過去の支出と割合は残り、集計できる。
      assert.equal((await all('SELECT id FROM expenses WHERE category_id = ?', g.categoryId)).length, 1);
      assert.equal((await monthApi(env).summary(g.people.alice, g.groupId, '2026-10')).status, 200);
      const restored = await api.updateCategory(g.people.alice, g.categoryId, { archived: false });
      assert.equal(restored.body.category.archivedAt, null);
      assert.equal((await registerExpense(g, g.people.alice, g.categoryId, 1000)).status, 201);
    });

    it('入力の不備は400。知らない費目は404、他のグループの人も404、脱退が確定した人は403', async () => {
      const f = await factory();
      const cases: [unknown, string | undefined][] = [
        [{}, undefined],
        [{ name: '' }, 'name'],
        [{ icon: 'Bad' }, 'icon'],
        [{ archived: 'yes' }, 'archived'],
        [{ sortOrder: 1 }, 'sortOrder'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(
          await api.updateCategory(f.alice, f.categoryId, body),
          { status: 400, body: field === undefined ? { error: 'invalid_request' } : { error: 'invalid_request', field } },
          JSON.stringify(body),
        );
      }
      assert.equal((await api.updateCategory(f.alice, 'no-such-category', { name: 'x' })).status, 404);
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.deepEqual(await api.updateCategory(who, f.categoryId, { name: 'x' }), { status: 404, body: { error: 'not_found' } });
      }
      assert.equal((await api.updateCategory(f.other.member, f.categoryId, { name: 'x' })).status, 404);
      assert.deepEqual(await api.updateCategory(f.carol, f.categoryId, { name: 'x' }), { status: 403, body: { error: 'forbidden' } });
      assert.equal((await api.updateCategory(null, f.categoryId, { name: 'x' })).status, 401);
      assert.equal((await all('SELECT name FROM categories WHERE id = ?', f.categoryId))[0]!.name, 'food');
    });

    it('他のグループのメンバーが、自分のグループの費目として変えられない', async () => {
      const f = await factory();
      // other のメンバーが、他のグループの費目のIDで変えようとしても、費目は変わらない。
      const result = await api.updateCategory(f.other.member, f.categoryId, { name: 'x' });
      assert.equal(result.status, 404);
      assert.equal((await all('SELECT name FROM categories WHERE id = ?', f.categoryId))[0]!.name, 'food');
    });

    it('読んだあとに別の書き込みが入れば、1回やり直す。続けて入れば409', async () => {
      const g = await setup();
      const once = await api.updateCategory(g.people.alice, g.categoryId, { name: '一度' }, { env: interferingEnv(env, bumpVersion(g.groupId), { times: 1 }) });
      assert.equal(once.status, 200);
      const twice = await api.updateCategory(g.people.alice, g.categoryId, { name: '二度' }, { env: interferingEnv(env, bumpVersion(g.groupId), { times: 2 }) });
      assert.deepEqual(twice, { status: 409, body: { error: 'conflict' } });
      assert.equal((await all('SELECT name FROM categories WHERE id = ?', g.categoryId))[0]!.name, '一度');
    });
  });

  // --- 並べ替え ---------------------------------------------------------------------------------

  describe('PUT /groups/:id/categories/order', () => {
    it('全費目（アーカイブ済みも含む）を並べ替える', async () => {
      const g = await setup();
      const second = await api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, name: '二番' });
      const third = await api.createCategory(g.people.alice, g.groupId, { ...NEW_CATEGORY, name: '三番' });
      await api.updateCategory(g.people.alice, second.body.category.id, { archived: true });
      const ids = [third.body.category.id, g.categoryId, second.body.category.id];
      const result = await api.reorderCategories(g.people.bob, g.groupId, { categoryIds: ids });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.categories.map((c: { id: string }) => c.id), ids);
      assert.deepEqual(result.body.categories.map((c: { sortOrder: number }) => c.sortOrder), [0, 1, 2]);
      const listed = await api.listCategories(g.people.alice, g.groupId);
      assert.deepEqual(listed.body.categories.map((c: { id: string }) => c.id), ids);
      // 費目の割合や名前は変わらない。
      assert.equal(listed.body.categories.find((c: { id: string }) => c.id === second.body.category.id).archivedAt, NOW);
    });

    it('グループの全費目と合わないとき(足りない・知らないID)は409で、何も変えない', async () => {
      const g = await setup();
      const other = await setup();
      const created = await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY);
      const bad: string[][] = [
        [g.categoryId], // 足りない
        [g.categoryId, created.body.category.id, 'extra'], // 知らないID
        [g.categoryId, other.categoryId], // 他のグループの費目
      ];
      for (const categoryIds of bad) {
        assert.deepEqual(await api.reorderCategories(g.people.alice, g.groupId, { categoryIds }), { status: 409, body: { error: 'categories_changed' } });
      }
      assert.deepEqual(
        (await all<{ id: string }>('SELECT id FROM categories WHERE group_id = ? ORDER BY sort_order', g.groupId)).map((row) => row.id),
        [g.categoryId, created.body.category.id],
      );
      assert.equal((await all<{ sort_order: number }>('SELECT sort_order FROM categories WHERE id = ?', other.categoryId))[0]!.sort_order, 0);
    });

    it('並べ替えの前に費目が増えていれば（読み直しても合わない）409', async () => {
      const g = await setup();
      const created = await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY);
      const ids = [created.body.category.id, g.categoryId];
      const addAnother = async () => {
        await factory.addCategory(g.groupId, 'late');
        await bumpVersion(g.groupId)();
      };
      const result = await api.reorderCategories(g.people.alice, g.groupId, { categoryIds: ids }, { env: interferingEnv(env, addAnother, { times: 1 }) });
      assert.deepEqual(result, { status: 409, body: { error: 'categories_changed' } });
    });

    it('入力の不備は400。脱退が確定した人は403、メンバーでない人は404', async () => {
      const f = await factory();
      for (const body of [{}, { categoryIds: [] }, { categoryIds: 'x' }, { categoryIds: [f.categoryId, f.categoryId] }, { categoryIds: [1] }, { categoryIds: [f.categoryId], extra: 1 }]) {
        const result = await api.reorderCategories(f.alice, f.groupId, body);
        assert.equal(result.status, 400, JSON.stringify(body));
      }
      const ok = [f.archivedCategoryId, f.categoryId];
      assert.equal((await api.reorderCategories(f.carol, f.groupId, { categoryIds: ok })).status, 403);
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.equal((await api.reorderCategories(who, f.groupId, { categoryIds: ok })).status, 404);
      }
      assert.equal((await api.reorderCategories(null, f.groupId, { categoryIds: ok })).status, 401);
    });
  });

  // --- 月ごとの負担割合: 取得 ---------------------------------------------------------------------

  describe('GET /groups/:id/months/:month/category-shares', () => {
    it('その月の割合（その月以前で最も新しい月の行）と、割合に入るメンバーを返す', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', [[alice.memberId, 7000], [bob.memberId, 3000]], { memberId: alice.memberId, capMinor: 20000 });
      const nov = await api.getRules(alice, g.groupId, '2026-11');
      assert.equal(nov.status, 200);
      assert.equal(nov.body.month, '2026-11');
      assert.equal(nov.body.closed, false);
      assert.equal(nov.body.editable, true);
      assert.deepEqual(nov.body.memberIds, [alice.memberId, bob.memberId].sort());
      assert.deepEqual(nov.body.categories, [
        {
          categoryId: g.categoryId,
          sourceMonth: '2026-11',
          shares: [{ memberId: alice.memberId, basisPoints: 7000 }, { memberId: bob.memberId, basisPoints: 3000 }],
          cap: { memberId: alice.memberId, capMinor: 20000 },
          memberChangedAt: null,
          memberChangeKind: null,
          archived: false,
        },
      ]);
      // 10月は、10月の行（均等・上限額なし）。
      const oct = await api.getRules(alice, g.groupId, '2026-10');
      assert.equal(oct.body.categories[0].sourceMonth, '2026-10');
      assert.deepEqual(oct.body.categories[0].shares.map((s: { basisPoints: number }) => s.basisPoints), [5000, 5000]);
      assert.equal(oct.body.categories[0].cap, null);
      // 12月は行が無いので、11月を引き継ぐ。
      const dec = await api.getRules(alice, g.groupId, '2026-12');
      assert.equal(dec.body.categories[0].sourceMonth, '2026-11');
      assert.equal(dec.body.editable, false); // 登録できる月(~2026-11)より先
    });

    it('締めた月は editable が false。割合が無い月(費目を作る前)の費目は含めない', async () => {
      const g = await setup();
      await insertClosing(db, g.groupId, '2026-10', g.people.alice.memberId);
      const created = await api.createCategory(g.people.alice, g.groupId, NEW_CATEGORY);
      const oct = await api.getRules(g.people.alice, g.groupId, '2026-10');
      assert.equal(oct.body.closed, true);
      assert.equal(oct.body.editable, false);
      assert.deepEqual(oct.body.categories.map((c: { categoryId: string }) => c.categoryId), [g.categoryId]);
      const nov = await api.getRules(g.people.alice, g.groupId, '2026-11');
      assert.equal(nov.body.editable, true);
      assert.ok(nov.body.categories.some((c: { categoryId: string }) => c.categoryId === created.body.category.id));
    });

    it('脱退が確定した人(leaving)は読めるが、editable は false。アーカイブした費目は archived で分かる', async () => {
      const f = await factory();
      await insertCategoryRule(db, f.groupId, f.categoryId, '2026-10', equalShares([f.alice.memberId, f.bob.memberId, f.carol.memberId, f.daveMemberId, f.erin.memberId]));
      await insertCategoryRule(db, f.groupId, f.archivedCategoryId, '2026-10', equalShares([f.alice.memberId, f.bob.memberId, f.carol.memberId, f.daveMemberId, f.erin.memberId]));
      const carol = await api.getRules(f.carol, f.groupId, '2026-10');
      assert.equal(carol.status, 200);
      assert.equal(carol.body.editable, false);
      assert.deepEqual(carol.body.categories.map((c: { archived: boolean }) => c.archived).sort(), [false, true]);
    });

    it('参加前の月は403、メンバーでない人は404、セッション無しは401', async () => {
      const f = await factory();
      assert.deepEqual(await api.getRules(f.newbie, f.groupId, '2026-10'), { status: 403, body: { error: 'forbidden' } });
      assert.equal((await api.getRules(f.newbie, f.groupId, '2026-11')).status, 200);
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.deepEqual(await api.getRules(who, f.groupId, '2026-11'), { status: 404, body: { error: 'not_found' } });
      }
      assert.equal((await api.getRules(null, f.groupId, '2026-11')).status, 401);
    });
  });

  // --- 月ごとの負担割合: 変更 ---------------------------------------------------------------------

  describe('PUT /groups/:id/months/:month/category-shares/:categoryId', () => {
    it('その月の割合を置き換える。集計に反映される', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const before = await dataVersion(g.groupId);
      assert.equal((await registerExpense(g, alice, g.categoryId, 10000)).status, 201);
      const result = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, {
        shares: [{ memberId: bob.memberId, basisPoints: 3000 }, { memberId: alice.memberId, basisPoints: 7000 }],
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {
        month: '2026-10',
        rule: {
          categoryId: g.categoryId,
          sourceMonth: '2026-10',
          shares: [{ memberId: alice.memberId, basisPoints: 7000 }, { memberId: bob.memberId, basisPoints: 3000 }].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
          cap: null,
          memberChangedAt: null,
          memberChangeKind: null,
        },
        overriddenMonths: [],
      });
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), [[alice.memberId, 7000], [bob.memberId, 3000]].sort());
      assert.equal(await dataVersion(g.groupId), before + 2); // 支出の登録と、この変更
      const summary = await monthApi(env).summary(bob, g.groupId, '2026-10');
      assert.deepEqual(summary.body.members.map((m: { memberId: string; burdenMinor: number }) => [m.memberId, m.burdenMinor]), [[alice.memberId, 7000], [bob.memberId, 3000]]);
    });

    it('上限額つきにでき、外すこともできる', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const shares = [{ memberId: alice.memberId, basisPoints: 0 }, { memberId: bob.memberId, basisPoints: 10000 }];
      const capped = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, { shares, cap: { memberId: alice.memberId, capMinor: 10000 } });
      assert.equal(capped.status, 200);
      assert.deepEqual(capped.body.rule.cap, { memberId: alice.memberId, capMinor: 10000 });
      assert.equal((await registerExpense(g, bob, g.categoryId, 15000)).status, 201);
      // 月合計15000: 上限10000までは alice、超えた5000は割合どおり bob。
      const summary = await monthApi(env).summary(bob, g.groupId, '2026-10');
      assert.deepEqual(summary.body.members.map((m: { burdenMinor: number }) => m.burdenMinor), [10000, 5000]);
      const removed = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, { shares, cap: null });
      assert.equal(removed.body.rule.cap, null);
      const setting = await all<{ cap_member_id: string | null; cap_minor: number | null }>('SELECT cap_member_id, cap_minor FROM category_month_settings WHERE category_id = ?', g.categoryId);
      assert.deepEqual(setting, [{ cap_member_id: null, cap_minor: null }]);
      assert.equal((await all('SELECT member_id FROM category_month_shares WHERE category_id = ? AND target_month = ?', g.categoryId, '2026-10')).length, 2);
    });

    it('行が無い月(前の月を引き継ぐ月)に書くと、その月の行を足し、前の月の行は変えない', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const result = await api.putRule(alice, g.groupId, '2026-11', g.categoryId, {
        shares: [{ memberId: alice.memberId, basisPoints: 6000 }, { memberId: bob.memberId, basisPoints: 4000 }],
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await ruleMonthsOf(g.categoryId), ['2026-10', '2026-11']);
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), equalShares([alice.memberId, bob.memberId]));
      assert.deepEqual(await sharesOf(g.categoryId, '2026-11'), [[alice.memberId, 6000], [bob.memberId, 4000]].sort());
    });

    it('この月より後に別の行がある月は、書き換えず、overriddenMonths で知らせる', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-11', [[alice.memberId, 5000], [bob.memberId, 5000]]);
      const result = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, {
        shares: [{ memberId: alice.memberId, basisPoints: 9000 }, { memberId: bob.memberId, basisPoints: 1000 }],
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.overriddenMonths, ['2026-11']);
      assert.deepEqual(await sharesOf(g.categoryId, '2026-11'), [[alice.memberId, 5000], [bob.memberId, 5000]].sort());
    });

    it('割合に入るのは、その月に参加している全員（削除したユーザーも、削除した月までは）。過不足は409 members_changed', async () => {
      const f = await factory();
      const everyone = [f.alice.memberId, f.bob.memberId, f.carol.memberId, f.daveMemberId, f.erin.memberId];
      await insertCategoryRule(db, f.groupId, f.categoryId, '2026-10', equalShares(everyone));
      const required = [...everyone].sort();
      const withShares = (ids: string[]) => ({ shares: ids.map((memberId, index) => ({ memberId, basisPoints: index === 0 ? 10000 : 0 })) });
      // 削除したユーザー(dave)を抜くと足りない。
      const missing = await api.putRule(f.alice, f.groupId, '2026-10', f.categoryId, withShares(everyone.filter((id) => id !== f.daveMemberId)));
      assert.deepEqual(missing, { status: 409, body: { error: 'members_changed', memberIds: required } });
      // 10月には参加していない newbie が入っていると多い。
      const extra = await api.putRule(f.alice, f.groupId, '2026-10', f.categoryId, withShares([...everyone, f.newbie.memberId]));
      assert.equal(extra.status, 409);
      assert.equal(extra.body.error, 'members_changed');
      // 他のグループのメンバーのIDも、同じく断る。
      const foreign = await api.putRule(f.alice, f.groupId, '2026-10', f.categoryId, withShares([...everyone.slice(1), f.other.member.memberId]));
      assert.equal(foreign.status, 409);
      // 削除したユーザーを0%にして、全員そろえば通る。
      const ok = await api.putRule(f.alice, f.groupId, '2026-10', f.categoryId, {
        shares: everyone.map((memberId) => ({ memberId, basisPoints: memberId === f.alice.memberId ? 5000 : memberId === f.bob.memberId ? 5000 : 0 })),
      });
      assert.equal(ok.status, 200);
      // 11月は newbie が加わり、erin(脱退済み。10月まで)と dave(削除。10月まで)が外れる。
      const november = [f.alice.memberId, f.bob.memberId, f.carol.memberId, f.newbie.memberId];
      await insertCategoryRule(db, f.groupId, f.categoryId, '2026-11', equalShares(november));
      const nov = await api.putRule(f.alice, f.groupId, '2026-11', f.categoryId, {
        shares: november.map((memberId, index) => ({ memberId, basisPoints: index === 0 ? 10000 : 0 })),
      });
      assert.equal(nov.status, 200);
    });

    it('入力の不備は400で、直す項目を返す', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const half = [{ memberId: alice.memberId, basisPoints: 5000 }, { memberId: bob.memberId, basisPoints: 5000 }];
      const cases: [unknown, string][] = [
        [{}, 'shares'],
        [{ shares: [] }, 'shares'],
        [{ shares: [{ memberId: alice.memberId, basisPoints: 10000 }, { memberId: bob.memberId, basisPoints: 1 }] }, 'shares'], // 合計が10001
        [{ shares: [{ memberId: alice.memberId, basisPoints: 4000 }, { memberId: bob.memberId, basisPoints: 5000 }] }, 'shares'], // 合計が9000
        [{ shares: [{ memberId: alice.memberId, basisPoints: 10001 }, { memberId: bob.memberId, basisPoints: -1 }] }, 'shares'],
        [{ shares: [{ memberId: alice.memberId, basisPoints: 5000 }, { memberId: alice.memberId, basisPoints: 5000 }] }, 'shares'], // 重複
        [{ shares: [{ memberId: alice.memberId, basisPoints: 50.5 }, { memberId: bob.memberId, basisPoints: 9949.5 }] }, 'shares'],
        [{ shares: [{ memberId: alice.memberId, basisPoints: 5000, extra: 1 }, { memberId: bob.memberId, basisPoints: 5000 }] }, 'shares'],
        [{ shares: half, extra: 1 }, 'extra'],
        [{ shares: half, cap: { memberId: 'someone-else', capMinor: 100 } }, 'cap.memberId'], // 上限の人が、割合の中にいない
        [{ shares: half, cap: { memberId: alice.memberId, capMinor: 0 } }, 'cap.capMinor'],
        [{ shares: half, cap: { memberId: alice.memberId, capMinor: 10 ** 12 + 1 } }, 'cap.capMinor'],
        [{ shares: half, cap: { memberId: alice.memberId, capMinor: 1.5 } }, 'cap.capMinor'],
        [{ shares: half, cap: { memberId: alice.memberId } }, 'cap.capMinor'],
        [{ shares: half, cap: 5 }, 'cap'],
      ];
      for (const [body, field] of cases) {
        assert.deepEqual(await api.putRule(alice, g.groupId, '2026-10', g.categoryId, body), { status: 400, body: { error: 'invalid_request', field } }, JSON.stringify(body));
      }
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), equalShares([alice.memberId, bob.memberId]));
    });

    it('締めた月は409 month_closed。直せる月(登録できる月)より先は409 month_not_editable', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const body = { shares: [{ memberId: alice.memberId, basisPoints: 5000 }, { memberId: bob.memberId, basisPoints: 5000 }] };
      // 12月は、今月(11月)より先。
      assert.deepEqual(await api.putRule(alice, g.groupId, '2026-12', g.categoryId, body), {
        status: 409,
        body: { error: 'month_not_editable', from: '2026-10', to: '2026-11' },
      });
      await insertClosing(db, g.groupId, '2026-10', alice.memberId);
      assert.deepEqual(await api.putRule(alice, g.groupId, '2026-10', g.categoryId, body), { status: 409, body: { error: 'month_closed' } });
      // 今月(11月)を締めたあとは、翌月(12月)だけ直せる。
      await insertClosing(db, g.groupId, '2026-11', alice.memberId);
      assert.equal((await api.putRule(alice, g.groupId, '2026-11', g.categoryId, body)).body.error, 'month_closed');
      assert.equal((await api.putRule(alice, g.groupId, '2026-12', g.categoryId, body)).status, 200);
      assert.deepEqual(await api.putRule(alice, g.groupId, '2027-01', g.categoryId, body), {
        status: 409,
        body: { error: 'month_not_editable', from: '2026-12', to: '2026-12' },
      });
      assert.equal((await api.putRule(alice, g.groupId, '2026-12', g.categoryId, body, { now: NOW_DECEMBER })).status, 200);
    });

    it('上限額は通貨の最小単位。currencyCode を送ったときは、グループの通貨と突き合わせる', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const shares = [{ memberId: alice.memberId, basisPoints: 0 }, { memberId: bob.memberId, basisPoints: 10000 }];
      const cap = { memberId: alice.memberId, capMinor: 10000 };
      const versionBefore = await dataVersion(g.groupId);
      assert.deepEqual(await api.putRule(alice, g.groupId, '2026-10', g.categoryId, { shares, cap, currencyCode: 'USD' }), {
        status: 409,
        body: { error: 'currency_mismatch', currencyCode: 'JPY' },
      });
      assert.equal(await dataVersion(g.groupId), versionBefore);
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), equalShares([alice.memberId, bob.memberId]));
      assert.equal((await api.putRule(alice, g.groupId, '2026-10', g.categoryId, { shares, cap, currencyCode: 'JPY' })).status, 200);
      assert.deepEqual(await api.putRule(alice, g.groupId, '2026-10', g.categoryId, { shares, currencyCode: 'jpy' }), {
        status: 400,
        body: { error: 'invalid_request', field: 'currencyCode' },
      });
    });

    it('アーカイブした費目の割合も直せる', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      await api.updateCategory(alice, g.categoryId, { archived: true });
      const result = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, {
        shares: [{ memberId: alice.memberId, basisPoints: 8000 }, { memberId: bob.memberId, basisPoints: 2000 }],
      });
      assert.equal(result.status, 200);
    });

    it('参加前の月・脱退が確定した人は403。メンバーでない人・知らない費目・他のグループの費目は404', async () => {
      const f = await factory();
      const body = { shares: [{ memberId: f.newbie.memberId, basisPoints: 10000 }] };
      assert.deepEqual(await api.putRule(f.newbie, f.groupId, '2026-10', f.categoryId, body), { status: 403, body: { error: 'forbidden' } });
      assert.equal((await api.putRule(f.carol, f.groupId, '2026-11', f.categoryId, body)).status, 403);
      for (const who of [f.outsider, f.erin, f.other.member]) {
        assert.equal((await api.putRule(who, f.groupId, '2026-11', f.categoryId, body)).status, 404);
      }
      assert.equal((await api.putRule(f.alice, f.groupId, '2026-11', 'no-such-category', { shares: [{ memberId: f.alice.memberId, basisPoints: 10000 }] })).status, 404);
      assert.equal((await api.putRule(f.alice, f.groupId, '2026-11', f.other.categoryId, { shares: [{ memberId: f.alice.memberId, basisPoints: 10000 }] })).status, 404);
      assert.equal((await api.putRule(null, f.groupId, '2026-11', f.categoryId, body)).status, 401);
    });

    it('読んだあとに別の書き込みが入れば、1回やり直す。続けて入れば409で、割合は変わらない', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const body = (a: number) => ({ shares: [{ memberId: alice.memberId, basisPoints: a }, { memberId: bob.memberId, basisPoints: 10000 - a }] });
      const once = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, body(6000), { env: interferingEnv(env, bumpVersion(g.groupId), { times: 1 }) });
      assert.equal(once.status, 200);
      const twice = await api.putRule(alice, g.groupId, '2026-10', g.categoryId, body(9000), { env: interferingEnv(env, bumpVersion(g.groupId), { times: 2 }) });
      assert.deepEqual(twice, { status: 409, body: { error: 'conflict' } });
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), [[alice.memberId, 6000], [bob.memberId, 4000]].sort());
    });

    it('読んだあとに月が締められたら、やり直した検証で month_closed になり、割合は変わらない', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const closeOctober = () => insertClosing(db, g.groupId, '2026-10', alice.memberId);
      const result = await api.putRule(
        alice,
        g.groupId,
        '2026-10',
        g.categoryId,
        { shares: [{ memberId: alice.memberId, basisPoints: 9000 }, { memberId: bob.memberId, basisPoints: 1000 }] },
        { env: interferingEnv(env, closeOctober, { times: 1 }) },
      );
      assert.deepEqual(result, { status: 409, body: { error: 'month_closed' } });
      assert.deepEqual(await sharesOf(g.categoryId, '2026-10'), equalShares([alice.memberId, bob.memberId]));
    });

    it('ルーティング: 入口から、取得と変更が呼べる', async () => {
      const g = await setup();
      const { alice, bob } = g.people;
      const got = await read(await worker.fetch(request('GET', `/groups/${g.groupId}/months/2026-10/category-shares`, alice.token), env));
      assert.equal(got.status, 200);
      const put = await read(
        await worker.fetch(
          request('PUT', `/groups/${g.groupId}/months/2026-10/category-shares/${g.categoryId}`, bob.token, {
            shares: [{ memberId: alice.memberId, basisPoints: 5000 }, { memberId: bob.memberId, basisPoints: 5000 }],
          }),
          env,
        ),
      );
      // 入口は実時計で動く。登録できる月は 2026-10 から今月までなので、実時計がいつでも 2026-10 は直せる。
      assert.equal(put.status, 200);
      assert.equal((await read(await worker.fetch(request('GET', `/groups/${g.groupId}/months/bad/category-shares`, alice.token), env))).status, 404);
      assert.equal((await read(await worker.fetch(request('POST', `/groups/${g.groupId}/months/2026-10/category-shares`, alice.token), env))).status, 405);
    });
  });
});
