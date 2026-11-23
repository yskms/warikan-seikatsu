/// <reference types="node" />
// 固定費の自動登録（src/recurringRun.ts と、それを呼ぶ src/cron.ts）の検査。規則は docs/backend-design.md 7章・8章。
// ローカルD1（miniflare）での検査なので、確かめるのはロジック。並行して走ったときの性質は、
// 「読んだあとに別の書き込みが入った」状況で再現して確かめている（本番D1での確認は13章の9）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { runScheduled } from '../src/cron.ts';
import worker from '../src/index.ts';
import { handleListExpenses } from '../src/expenses.ts';
import { dueTemplatesSql, ESTIMATED_QUERIES_PER_RECURRING_GROUP, registerDueRecurring } from '../src/recurringRun.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertRecurringRow,
  NOW,
} from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { countingEnv, interferingEnv, NOW_DECEMBER, read, request } from './monthApi.ts';
import { recurringApi } from './recurringApi.ts';

/** 2026-11-24 23:30（Asia/Tokyo）。25日の前。 */
const NOV_24_2330_JST = Date.UTC(2026, 10, 24, 14, 30, 0);
/** 2026-11-25 00:30（Asia/Tokyo）。 */
const NOV_25_0030_JST = Date.UTC(2026, 10, 24, 15, 30, 0);
/** 2026-11-30 12:00（Asia/Tokyo）。11月の末日。 */
const NOV_30_NOON_JST = Date.UTC(2026, 10, 30, 3, 0, 0);
/** 2026-12-01 00:30（Asia/Tokyo）。UTCではまだ11月30日。 */
const DEC_01_0030_JST = Date.UTC(2026, 10, 30, 15, 30, 0);
/** 2026-12-06 12:00（Asia/Tokyo）。 */
const DEC_06_JST = Date.UTC(2026, 11, 6, 3, 0, 0);

interface ExpenseRow {
  id: string;
  group_id: string;
  expense_date: string;
  target_month: string;
  description: string | null;
  amount_minor: number;
  category_id: string;
  payer_member_id: string;
  created_by_member_id: string;
  split_method: string;
  recurring_expense_id: string | null;
  created_at: number;
  updated_at: number;
}

const expensesIn = async (db: D1Database, groupId: string) =>
  (await db.prepare('SELECT * FROM expenses WHERE group_id = ? ORDER BY expense_date, recurring_expense_id').bind(groupId).all<ExpenseRow>())
    .results;
const runsIn = async (db: D1Database, groupId: string) =>
  (
    await db
      .prepare('SELECT recurring_expense_id, scheduled_month, expense_id FROM recurring_expense_runs WHERE group_id = ? ORDER BY scheduled_month, recurring_expense_id')
      .bind(groupId)
      .all<{ recurring_expense_id: string; scheduled_month: string; expense_id: string }>()
  ).results;
const burdensIn = async (db: D1Database, expenseId: string) =>
  (
    await db
      .prepare('SELECT member_id, burden_minor, share_basis_points FROM expense_allocations WHERE expense_id = ? ORDER BY member_id')
      .bind(expenseId)
      .all<{ member_id: string; burden_minor: number; share_basis_points: number | null }>()
  ).results;
const versionIn = async (db: D1Database, groupId: string) =>
  (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
    .data_version;
const bumpIn = (db: D1Database, groupId: string) => () =>
  db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(groupId).run();

/**
 * テストごとに新しいDBを使う。割り込み（interferingEnv）は「最初の batch」に効くので、共有のDBでは、ほかのグループの
 * 書き込みが先に拾ってしまう。定期処理の全体（runScheduled）も、ほかのテストのグループの脱退の確定を巻き込む。
 */
async function isolated(
  fn: (context: { db: D1Database; env: Env; factory: ReturnType<typeof createFixtureFactory> }) => Promise<void>,
): Promise<void> {
  const local = await openLocalDatabase();
  try {
    await fn({ db: local.db, env: local.env, factory: createFixtureFactory(local.db) });
  } finally {
    await local.dispose();
  }
}

describe('固定費の自動登録', () => {
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

  /** 自動登録だけを動かす（脱退の確定は動かさない）。予算は気にしない。 */
  const run = (now: number, runEnv: Env = env) => registerDueRecurring(runEnv.DB, now, 0, 1000);
  const simple = () => factory.createGroup(['alice', 'bob']);
  const expensesOf = (groupId: string) => expensesIn(db, groupId);
  const runsOf = (groupId: string) => runsIn(db, groupId);
  const burdensOf = (expenseId: string) => burdensIn(db, expenseId);
  const versionOf = (groupId: string) => versionIn(db, groupId);

  it('予定日になった固定費から支出を作る: 日付・対象月・支払者・登録者・生成記録・バージョン', async () => {
    const g = await simple();
    const { alice } = g.people;
    const recurring = await insertRecurringRow(db, {
      groupId: g.groupId,
      categoryId: g.categoryId,
      payerMemberId: alice.memberId,
      dayOfMonth: 5,
    });
    const version = await versionOf(g.groupId);

    const summary = await run(NOW);
    assert.ok(summary.createdGroups.includes(g.groupId));

    const [expense, ...rest] = await expensesOf(g.groupId);
    assert.equal(rest.length, 0);
    assert.deepEqual(
      { ...expense!, id: undefined },
      {
        id: undefined,
        group_id: g.groupId,
        expense_date: '2026-11-05',
        target_month: '2026-11',
        description: '家賃',
        amount_minor: 80000,
        category_id: g.categoryId,
        payer_member_id: alice.memberId,
        // 自動登録は誰かが登録したものではない。支払者が登録した扱い。
        created_by_member_id: alice.memberId,
        split_method: 'category',
        recurring_expense_id: recurring,
        created_at: NOW,
        updated_at: NOW,
      },
    );
    assert.deepEqual(await burdensOf(expense!.id), [], 'category の支出は負担額を持たない（月の集計で計算する）');
    assert.deepEqual(await runsOf(g.groupId), [
      { recurring_expense_id: recurring, scheduled_month: '2026-11', expense_id: expense!.id },
    ]);
    assert.equal(await versionOf(g.groupId), version + 1);
  });

  it('冪等: 2回動かしても、2回目は何も作らない（バージョンも上がらない）。作った支出を消しても作り直さない', async () => {
    const g = await simple();
    await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 5 });
    await run(NOW);
    const version = await versionOf(g.groupId);
    const second = await run(NOW);
    assert.ok(!second.createdGroups.includes(g.groupId));
    assert.equal(await versionOf(g.groupId), version);
    assert.equal((await expensesOf(g.groupId)).length, 1);

    // ユーザーが支出を消しても、生成記録は残るので、作り直さない。
    const [expense] = await expensesOf(g.groupId);
    await db.prepare('DELETE FROM expenses WHERE id = ?').bind(expense!.id).run();
    const third = await run(NOW + 3_600_000);
    assert.ok(!third.createdGroups.includes(g.groupId));
    assert.equal((await expensesOf(g.groupId)).length, 0);
    assert.equal((await runsOf(g.groupId)).length, 1);
  });

  it('予定日の前は作らない。予定日になれば、グループのタイムゾーンの0時以降に作る', async () => {
    const g = await simple();
    await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 25 });
    for (const now of [NOW, NOV_24_2330_JST]) {
      await run(now);
      assert.equal((await expensesOf(g.groupId)).length, 0, String(now));
    }
    const summary = await run(NOV_25_0030_JST);
    assert.ok(summary.createdGroups.includes(g.groupId));
    assert.equal((await expensesOf(g.groupId))[0]!.expense_date, '2026-11-25');
  });

  it('その月に無い日（31日指定の11月）は、月末日に作る。支出の日付も月末日', async () => {
    const g = await simple();
    await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 31 });
    await run(Date.UTC(2026, 10, 29, 3, 0, 0));
    assert.equal((await expensesOf(g.groupId)).length, 0, '11月29日はまだ');
    await run(NOV_30_NOON_JST);
    const [expense] = await expensesOf(g.groupId);
    assert.deepEqual([expense!.expense_date, expense!.target_month], ['2026-11-30', '2026-11']);
  });

  it('作らない固定費: 止まっている・終了した・まだ始まらない。開始月・終了月の月は作る', async () => {
    const g = await simple();
    const base = { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 5 };
    await insertRecurringRow(db, { ...base, description: '手動で停止', pausedReason: 'manual' });
    await insertRecurringRow(db, { ...base, description: '先月で終了', endMonth: '2026-10' });
    await insertRecurringRow(db, { ...base, description: '来月から', startMonth: '2026-12' });
    await insertRecurringRow(db, { ...base, description: '今月で終了', endMonth: '2026-11' });
    await insertRecurringRow(db, { ...base, description: '今月から', startMonth: '2026-11' });
    await run(NOW);
    assert.deepEqual(
      (await expensesOf(g.groupId)).map((expense) => expense.description).sort(),
      ['今月から', '今月で終了'],
    );
    // 来月になれば、来月からのものも作る。終了したものは作らない。
    await run(NOW_DECEMBER);
    assert.deepEqual(
      (await expensesOf(g.groupId)).map((expense) => `${expense.description}:${expense.target_month}`).sort(),
      ['今月から:2026-11', '今月から:2026-12', '今月で終了:2026-11', '来月から:2026-12'],
    );
  });

  it('過去の月の分は、あとから作らない（停止していた固定費を再開しても、今月の分だけ）', async () => {
    const g = await simple();
    await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 5, startMonth: '2026-10' });
    await run(NOW_DECEMBER);
    assert.deepEqual(
      (await runsOf(g.groupId)).map((row) => row.scheduled_month),
      ['2026-12'],
      '10月・11月の分は作らない',
    );
  });

  it('今月が早めに締められていれば、最も古い未締めの月（翌月）に作る。日付は予定日のまま。翌月には翌月分も作る', async () => {
    const g = await simple();
    const recurring = await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 5 });
    await insertClosing(db, g.groupId, '2026-11', g.people.alice.memberId);
    await run(NOW);
    const [early] = await expensesOf(g.groupId);
    assert.deepEqual([early!.expense_date, early!.target_month], ['2026-11-05', '2026-12']);
    assert.deepEqual(await runsOf(g.groupId), [{ recurring_expense_id: recurring, scheduled_month: '2026-11', expense_id: early!.id }]);

    await run(DEC_06_JST);
    const all = await expensesOf(g.groupId);
    assert.deepEqual(
      all.map((expense) => [expense.expense_date, expense.target_month]),
      [
        ['2026-11-05', '2026-12'],
        ['2026-12-05', '2026-12'],
      ],
      '翌月の対象月に2件になる',
    );
  });

  it('個別の負担設定は、作るときに計算して保存する（端数は固定順。割合指定は割合も残す）', async () => {
    const g = await simple();
    const a = g.people.alice.memberId;
    const b = g.people.bob.memberId;
    const base = { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: a, dayOfMonth: 5 };
    await insertRecurringRow(db, { ...base, description: 'equal', splitMethod: 'equal', amountMinor: 80001, allocations: [[a, null, null], [b, null, null]] });
    await insertRecurringRow(db, { ...base, description: 'ratio', splitMethod: 'ratio', amountMinor: 10001, allocations: [[a, 7000, null], [b, 3000, null]] });
    await insertRecurringRow(db, { ...base, description: 'fixed', splitMethod: 'fixed', amountMinor: 80000, allocations: [[a, null, 50000], [b, null, 30000]] });
    await insertRecurringRow(db, { ...base, description: 'single', splitMethod: 'single', amountMinor: 1234, allocations: [[b, null, null]] });
    await run(NOW);
    const byDescription = new Map((await expensesOf(g.groupId)).map((expense) => [expense.description, expense]));
    assert.equal(byDescription.size, 4);
    assert.deepEqual(await burdensOf(byDescription.get('equal')!.id), [
      { member_id: a, burden_minor: 40001, share_basis_points: null },
      { member_id: b, burden_minor: 40000, share_basis_points: null },
    ]);
    assert.deepEqual(await burdensOf(byDescription.get('ratio')!.id), [
      { member_id: a, burden_minor: 7001, share_basis_points: 7000 },
      { member_id: b, burden_minor: 3000, share_basis_points: 3000 },
    ]);
    assert.deepEqual(await burdensOf(byDescription.get('fixed')!.id), [
      { member_id: a, burden_minor: 50000, share_basis_points: null },
      { member_id: b, burden_minor: 30000, share_basis_points: null },
    ]);
    assert.deepEqual(await burdensOf(byDescription.get('single')!.id), [{ member_id: b, burden_minor: 1234, share_basis_points: null }]);
    assert.equal(byDescription.get('ratio')!.split_method, 'ratio');
  });

  it('1つのグループの固定費は、1回の書き込み（バージョンを1つだけ上げる）で作る', async () => {
    const g = await simple();
    for (let i = 0; i < 3; i++) {
      await insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId, dayOfMonth: 5, description: `固定費${i}` });
    }
    const version = await versionOf(g.groupId);
    const summary = await run(NOW);
    assert.equal(summary.createdExpenses >= 3, true);
    assert.equal((await expensesOf(g.groupId)).length, 3);
    assert.equal((await runsOf(g.groupId)).length, 3);
    assert.equal(await versionOf(g.groupId), version + 1);
  });

  it('アーカイブした費目の固定費は、止めずに、作るのだけを見送る。費目を戻すと作る', async () => {
    const g = await simple();
    const archived = await factory.addCategory(g.groupId, 'old', true);
    await insertRecurringRow(db, { groupId: g.groupId, categoryId: archived, payerMemberId: g.people.alice.memberId, dayOfMonth: 5 });
    await run(NOW);
    assert.equal((await expensesOf(g.groupId)).length, 0);
    assert.equal((await runsOf(g.groupId)).length, 0, '見送った分は、記録を残さない');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM recurring_expenses WHERE group_id = ? AND paused_at IS NULL').bind(g.groupId).first<{ n: number }>())!.n, 1, '止めてはいない');

    await db.prepare('UPDATE categories SET archived_at = NULL WHERE id = ?').bind(archived).run();
    await run(NOW + 3_600_000);
    assert.equal((await expensesOf(g.groupId)).length, 1);
  });

  it('支払者・負担の対象がその月に使えなければ、作らない（記録も残さない）。使える固定費は作る', async () => {
    // alice は2026-11で脱退。2026-12の支出には、alice を選べない。
    const g = await factory.createGroup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-11' } });
    const { alice, bob } = g.people;
    const base = { groupId: g.groupId, categoryId: g.categoryId, dayOfMonth: 5, startMonth: '2026-12' };
    await insertRecurringRow(db, { ...base, payerMemberId: alice.memberId, description: '支払者が脱退' });
    await insertRecurringRow(db, {
      ...base,
      payerMemberId: bob.memberId,
      description: '対象に脱退する人',
      splitMethod: 'equal',
      allocations: [[alice.memberId, null, null], [bob.memberId, null, null]],
    });
    await insertRecurringRow(db, { ...base, payerMemberId: bob.memberId, description: '使える' });
    await run(NOW_DECEMBER);
    assert.deepEqual((await expensesOf(g.groupId)).map((expense) => expense.description), ['使える']);
    assert.equal((await runsOf(g.groupId)).length, 1);
  });

  describe('グループのタイムゾーン', () => {
    it('ロサンゼルス: UTCでは12月でも、現地が11月30日なら、11月の分を作る（12月の分は作らない）', async () => {
      const g = await simple();
      await db.prepare("UPDATE expense_groups SET timezone = 'America/Los_Angeles' WHERE id = ?").bind(g.groupId).run();
      const base = { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId };
      await insertRecurringRow(db, { ...base, dayOfMonth: 1, description: '1日' });
      await insertRecurringRow(db, { ...base, dayOfMonth: 30, description: '30日' });
      // 2026-12-01 03:00 UTC = ロサンゼルスの 2026-11-30 19:00。
      await run(Date.UTC(2026, 11, 1, 3, 0, 0));
      assert.deepEqual(
        (await expensesOf(g.groupId)).map((expense) => [expense.description, expense.expense_date, expense.target_month]),
        [
          ['1日', '2026-11-01', '2026-11'],
          ['30日', '2026-11-30', '2026-11'],
        ],
      );
    });

    it('東京: UTCでは11月30日でも、現地が12月1日なら、12月の分を作る（11月の分は作らない）', async () => {
      const g = await simple();
      const base = { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice.memberId };
      await insertRecurringRow(db, { ...base, dayOfMonth: 1, description: '1日' });
      await insertRecurringRow(db, { ...base, dayOfMonth: 30, description: '30日' });
      await run(DEC_01_0030_JST);
      assert.deepEqual(
        (await expensesOf(g.groupId)).map((expense) => [expense.description, expense.expense_date, expense.target_month]),
        [['1日', '2026-12-01', '2026-12']],
      );
    });
  });

  describe('APIとつないだ流れ', () => {
    it('APIで登録した固定費が、予定日に支出になり、支出の一覧に出る（固定費のIDつき）。停止すると作られない', async () => {
      const f = await factory();
      const api = recurringApi(env);
      // NOW は11月19日。25日の固定費は、まだ予定日が来ていない。
      const create = (description: string) =>
        api.create(f.alice, f.groupId, {
          description,
          amountMinor: 3000,
          categoryId: f.categoryId,
          payerMemberId: f.bob.memberId,
          split: { method: 'ratio', shares: [{ memberId: f.alice.memberId, basisPoints: 6000 }, { memberId: f.bob.memberId, basisPoints: 4000 }] },
          dayOfMonth: 25,
          startMonth: '2026-11',
        });
      const active = (await create('回線')).body.recurringExpense;
      const stopped = (await create('停止')).body.recurringExpense;
      await api.update(f.alice, stopped.id, { paused: true });

      await run(NOW);
      assert.equal((await expensesOf(f.groupId)).length, 0, '予定日の前');
      await run(NOV_25_0030_JST);

      const list = await read(
        await handleListExpenses(request('GET', `/groups/${f.groupId}/expenses?month=2026-11`, f.alice.token), env, NOW, f.groupId),
      );
      assert.equal(list.status, 200);
      assert.equal(list.body.expenses.length, 1);
      assert.deepEqual(
        { ...list.body.expenses[0], id: undefined },
        {
          id: undefined,
          expenseDate: '2026-11-25',
          targetMonth: '2026-11',
          description: '回線',
          amountMinor: 3000,
          categoryId: f.categoryId,
          payerMemberId: f.bob.memberId,
          createdByMemberId: f.bob.memberId,
          recurringExpenseId: active.id,
          splitMethod: 'ratio',
          allocations: [
            { memberId: f.alice.memberId, burdenMinor: 1800, shareBasisPoints: 6000 },
            { memberId: f.bob.memberId, burdenMinor: 1200, shareBasisPoints: 4000 },
          ],
          createdAt: NOV_25_0030_JST,
          updatedAt: NOV_25_0030_JST,
        },
      );
      // 生成済みの支出は、固定費を変えても変わらない（まだ作っていない月の分から反映する）。
      await api.update(f.alice, active.id, { amountMinor: 9999 });
      assert.equal((await expensesOf(f.groupId))[0]!.amount_minor, 3000);
    });

    it('予定日を過ぎてから登録・再開した固定費は、今月の分を作らず（手で入力した分と二重にならない）、来月の予定日に作る', async () => {
      const f = await factory();
      const api = recurringApi(env);
      // 11月19日に、毎月5日の固定費を登録する。
      const result = await api.create(f.alice, f.groupId, {
        description: '家賃',
        amountMinor: 80000,
        categoryId: f.categoryId,
        payerMemberId: f.alice.memberId,
        split: { method: 'category' },
        dayOfMonth: 5,
        startMonth: '2026-11',
      });
      assert.equal(result.body.thisMonthSkipped, true);
      await run(NOW);
      await run(NOV_30_NOON_JST);
      assert.equal((await expensesOf(f.groupId)).length, 0, '今月の分は作らない');
      await run(NOW_DECEMBER);
      assert.deepEqual(
        (await expensesOf(f.groupId)).map((expense) => [expense.expense_date, expense.target_month]),
        [['2026-12-05', '2026-12']],
      );

      // 止めて、予定日を過ぎてから再開しても、同じ。
      const stopped = await api.update(f.alice, result.body.recurringExpense.id, { paused: true }, { now: NOW_DECEMBER + 1000 });
      assert.equal(stopped.status, 200);
      const resumed = await api.update(f.alice, result.body.recurringExpense.id, { paused: false }, { now: NOW_DECEMBER + 2000 });
      assert.equal(resumed.body.thisMonthSkipped, false, '12月の分は、もう作っている（記録を重ねない）');
      await run(NOW_DECEMBER + 3_600_000);
      assert.equal((await expensesOf(f.groupId)).length, 1);
    });
  });
});

describe('固定費の自動登録: D1のクエリ数の予算', () => {
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

  const groupWithTemplates = async (count: number, split: 'category' | 'equal' = 'category') => {
    const g = await factory.createGroup(['alice', 'bob']);
    for (let i = 0; i < count; i++) {
      await insertRecurringRow(db, {
        groupId: g.groupId,
        categoryId: g.categoryId,
        payerMemberId: g.people.alice.memberId,
        dayOfMonth: 5,
        description: `固定費${i}`,
        ...(split === 'equal'
          ? { splitMethod: 'equal' as const, allocations: [[g.people.alice.memberId, null, null], [g.people.bob.memberId, null, null]] as const }
          : {}),
      });
    }
    return g;
  };
  const expenseCount = async (groupId: string) =>
    (await db.prepare('SELECT count(*) AS n FROM expenses WHERE group_id = ?').bind(groupId).first<{ n: number }>())!.n;

  it('上限（50件）の固定費を持つグループでも、1回の実行は、1文ずつ数えて、Freeの上限（50）に収まる。数えた数と、報告する数が一致する', async () => {
    const g = await groupWithTemplates(50, 'equal');
    const counting = countingEnv(env);
    const summary = await registerDueRecurring(counting.env.DB, NOW, 0, 50);
    assert.deepEqual(summary.createdGroups, [g.groupId]);
    assert.equal(summary.createdExpenses, 50);
    assert.equal(await expenseCount(g.groupId), 50);
    assert.equal(summary.queries, counting.counts.queries, '見積もりが、実際とずれていない');
    assert.ok(counting.counts.queries <= 50, `${counting.counts.queries} クエリ`);
    // 書き込みは1回の batch。複数行を1文にまとめるので、文の数は固定費の数（50）より少ない。
    assert.equal(counting.counts.batchSizes.length, 1);
    assert.ok(counting.counts.batchSizes[0]! < 50, `batchの文の数 ${counting.counts.batchSizes[0]}`);
  });

  it('固定費が少ないグループは、候補の検索1回 + 読み込み5 + 書き込み数回で済む。何も作らないグループは、検索1回だけ', async () => {
    const g = await groupWithTemplates(1);
    const counting = countingEnv(env);
    const summary = await registerDueRecurring(counting.env.DB, NOW, 0, 50);
    assert.deepEqual(summary.createdGroups, [g.groupId]);
    assert.equal(summary.queries, counting.counts.queries);
    assert.ok(counting.counts.queries <= ESTIMATED_QUERIES_PER_RECURRING_GROUP, `${counting.counts.queries} クエリ`);

    // 作る固定費が無くなったので、候補の検索だけ（グループを読みにいかない）。
    const idle = countingEnv(env);
    const second = await registerDueRecurring(idle.env.DB, NOW, 0, 50);
    assert.equal(second.queries, 1);
    assert.equal(idle.counts.queries, 1);
  });

  it('予算に収まる範囲のグループだけ処理し、残りは次の回に回す。次の回で作る', async () => {
    const groups = [await groupWithTemplates(1), await groupWithTemplates(1), await groupWithTemplates(1)];
    // 検索1回 + 1グループ分の見積もり（12）がぎりぎり収まる予算。
    const budget = 1 + ESTIMATED_QUERIES_PER_RECURRING_GROUP;
    const first = await registerDueRecurring(env.DB, NOW, 0, budget);
    assert.equal(first.createdGroups.length, 1);
    assert.equal(first.postponedGroups.length, 2);
    assert.deepEqual([...first.createdGroups, ...first.postponedGroups].sort(), groups.map((g) => g.groupId).sort());
    for (const groupId of first.postponedGroups) assert.equal(await expenseCount(groupId), 0, '回したグループは何も変わらない');

    const second = await registerDueRecurring(env.DB, NOW, 0, budget);
    const third = await registerDueRecurring(env.DB, NOW, 0, budget);
    assert.equal(second.createdGroups.length + third.createdGroups.length, 2);
    for (const g of groups) assert.equal(await expenseCount(g.groupId), 1);
  });

  it('候補の検索は、固定費の表を読むだけ。生成記録は主キーで引く（毎時、全グループの生成記録を読まない）。グループごとの読み直しは索引を使う', async () => {
    const plan = async (filter: boolean) =>
      (
        await db
          .prepare(`EXPLAIN QUERY PLAN ${dueTemplatesSql(filter)}`)
          .bind('2026-11', '2026-12', ...(filter ? ['group'] : []))
          .all<{ detail: string }>()
      ).results.map((row) => row.detail);
    for (const filter of [false, true]) {
      const lines = await plan(filter);
      assert.ok(lines.some((line) => /SEARCH u USING PRIMARY KEY \(recurring_expense_id=\? AND scheduled_month=\?\)/.test(line)), lines.join(' / '));
      assert.ok(!lines.some((line) => /SCAN u/.test(line)), lines.join(' / '));
    }
    assert.ok((await plan(true)).some((line) => /idx_recurring_expenses_group/.test(line)));
  });

  it('固定費もメンバーも多いグループは、書く文の数を数えて、予算に収まる件数だけ作る。残りは次の回で作る（50を超えない）', async () => {
    // 50件 × 12人の金額指定 = 負担額600行。全部を1回で書くと、読み込みと合わせて51クエリ（1文ずつ数えた数）になり、Freeの上限（50）を超える。
    const names = Array.from({ length: 12 }, (_, index) => `m${String(index + 1).padStart(2, '0')}`);
    const g = await factory.createGroup(names);
    const ids = names.map((name) => g.people[name]!.memberId);
    for (let i = 0; i < 50; i++) {
      await insertRecurringRow(db, {
        groupId: g.groupId,
        categoryId: g.categoryId,
        payerMemberId: ids[0]!,
        dayOfMonth: 5,
        description: `固定費${i}`,
        splitMethod: 'fixed',
        amountMinor: 12000,
        allocations: ids.map((id) => [id, null, 1000] as const),
      });
    }

    let created = 0;
    for (let round = 0; round < 5; round++) {
      const counting = countingEnv(env);
      const summary = await registerDueRecurring(counting.env.DB, NOW, 0, 50);
      assert.equal(summary.queries, counting.counts.queries, `${round}回目: 数えた数と報告する数が一致する`);
      assert.ok(counting.counts.queries <= 50, `${round}回目: ${counting.counts.queries} クエリ`);
      created += summary.createdExpenses;
      if (round === 0) {
        assert.ok(summary.createdExpenses > 0 && summary.createdExpenses < 50, `1回目は一部だけ: ${summary.createdExpenses}`);
        assert.deepEqual(summary.createdGroups, [g.groupId]);
        assert.deepEqual(summary.postponedGroups, [g.groupId], '残りを次の回に回した');
      }
      if (summary.postponedGroups.length === 0) break;
    }
    assert.equal(created, 50);
    assert.equal(await expenseCount(g.groupId), 50, '二重に作らず、全部作った');
    const burdens = await db.prepare('SELECT count(*) AS n FROM expense_allocations WHERE group_id = ?').bind(g.groupId).first<{ n: number }>();
    assert.equal(burdens!.n, 600);
    const runs = await db.prepare('SELECT count(*) AS n FROM recurring_expense_runs WHERE group_id = ?').bind(g.groupId).first<{ n: number }>();
    assert.equal(runs!.n, 50);
  });

  it('予算が残っていなければ（脱退の確定が使い切った）、この処理そのものを見送る。何も読まない', async () => {
    const g = await groupWithTemplates(1);
    const counting = countingEnv(env);
    const used = 50 - ESTIMATED_QUERIES_PER_RECURRING_GROUP; // 検索1回 + 1グループ分が収まらない
    const summary = await registerDueRecurring(counting.env.DB, NOW, used, 50);
    assert.equal(summary.skipped, true);
    assert.equal(summary.queries, 0);
    assert.equal(counting.counts.queries, 0);
    assert.equal(await expenseCount(g.groupId), 0);
  });
});

describe('固定費の自動登録: 競合と、脱退の確定との順序（テストごとに新しいDB）', () => {
  const due = (db: D1Database, g: { groupId: string; categoryId: string; people: Record<string, { memberId: string }> }) =>
    insertRecurringRow(db, { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: g.people.alice!.memberId, dayOfMonth: 5 });

  it('読んだあとに利用者の書き込みが入ったら、何も作らず、次の回に回す。次の回で作る', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob']);
      await due(db, g);
      const first = await registerDueRecurring(interferingEnv(env, bumpIn(db, g.groupId)).DB, NOW, 0, 1000);
      assert.deepEqual(first.deferredGroups, [g.groupId]);
      assert.deepEqual(first.createdGroups, []);
      assert.equal((await expensesIn(db, g.groupId)).length, 0);
      assert.equal((await runsIn(db, g.groupId)).length, 0);

      const second = await registerDueRecurring(env.DB, NOW + 3_600_000, 0, 1000);
      assert.deepEqual(second.createdGroups, [g.groupId]);
      assert.equal((await expensesIn(db, g.groupId)).length, 1);
    }));

  it('同じ生成記録がすでにあって一意制約に違反したら、読んで確かめたうえで、正常として次の回に回す（失敗にしない）', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob']);
      const recurring = await due(db, g);
      // バージョンを上げずに、同じ(固定費, 予定の月)の生成記録が入る（二重作成を、主キーが防ぐ場面）。
      const insertRun = () =>
        db
          .prepare('INSERT INTO recurring_expense_runs (group_id, recurring_expense_id, scheduled_month, expense_id, created_at) VALUES (?, ?, ?, NULL, ?)')
          .bind(g.groupId, recurring, '2026-11', NOW)
          .run();
      const summary = await registerDueRecurring(interferingEnv(env, insertRun).DB, NOW, 0, 1000);
      assert.deepEqual(summary.deferredGroups, [g.groupId]);
      assert.deepEqual(summary.failedGroups, []);
      assert.equal((await expensesIn(db, g.groupId)).length, 0, '全体が取り消されている');
      assert.equal((await runsIn(db, g.groupId)).length, 1);
      const again = await registerDueRecurring(env.DB, NOW + 3_600_000, 0, 1000);
      assert.deepEqual(again.createdGroups, [], '記録があるので、作らない');
    }));

  it('生成記録が無いのに一意制約に違反したら、正常にせず、失敗として数える（実装の誤りを見逃さない）', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob']);
      await due(db, g);
      const failing = interferingEnv(env, async () => {
        throw new Error('D1_ERROR: UNIQUE constraint failed: expenses.id: SQLITE_CONSTRAINT');
      });
      const summary = await registerDueRecurring(failing.DB, NOW, 0, 1000);
      assert.deepEqual(summary.failedGroups, [g.groupId]);
      assert.deepEqual(summary.deferredGroups, []);
      assert.equal((await expensesIn(db, g.groupId)).length, 0);
    }));

  it('1つのグループの失敗で、ほかのグループを止めない。定期処理は、最後に失敗を投げる。次の回で作る', () =>
    isolated(async ({ db, env, factory }) => {
      const groups = [await factory.createGroup(['alice', 'bob']), await factory.createGroup(['alice', 'bob'])];
      for (const g of groups) await due(db, g);
      // 最初のグループの書き込み（batch）だけが、障害で失敗する。
      const failing = interferingEnv(env, async () => {
        throw new Error('D1の障害');
      });
      await assert.rejects(runScheduled(failing, NOW), /失敗したグループがある/);
      const counts = await Promise.all(groups.map(async (g) => (await expensesIn(db, g.groupId)).length));
      assert.deepEqual([...counts].sort(), [0, 1], '1つは失敗し、もう1つは作っている');
      await runScheduled(env, NOW + 3_600_000);
      assert.deepEqual(await Promise.all(groups.map(async (g) => (await expensesIn(db, g.groupId)).length)), [1, 1]);
    }));

  it('脱退の確定のあとに動く: 確定で止まった固定費（支払者が脱退・負担が個別）は作らず、そうでないものは作る', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-11' } });
      const { alice, bob } = g.people;
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([alice.memberId, bob.memberId]));
      const base = { groupId: g.groupId, categoryId: g.categoryId, dayOfMonth: 5, startMonth: '2026-10' };
      const payerLeft = await insertRecurringRow(db, { ...base, payerMemberId: alice.memberId, description: '支払者が脱退' });
      const individual = await insertRecurringRow(db, {
        ...base,
        payerMemberId: bob.memberId,
        description: '個別の負担',
        splitMethod: 'equal',
        allocations: [[alice.memberId, null, null], [bob.memberId, null, null]],
      });
      const normal = await insertRecurringRow(db, { ...base, payerMemberId: bob.memberId, description: '費目の割合' });

      const summary = await runScheduled(env, NOW_DECEMBER);
      assert.deepEqual(summary.confirmedGroups, [g.groupId]);
      assert.deepEqual(summary.recurring.createdGroups, [g.groupId]);
      assert.deepEqual((await expensesIn(db, g.groupId)).map((expense) => expense.description), ['費目の割合']);
      const reasons = await db
        .prepare('SELECT id, paused_reason FROM recurring_expenses WHERE group_id = ?')
        .bind(g.groupId)
        .all<{ id: string; paused_reason: string | null }>();
      assert.deepEqual(Object.fromEntries(reasons.results.map((row) => [row.id, row.paused_reason])), {
        [payerLeft]: 'payer_left',
        [individual]: 'member_changed',
        [normal]: null,
      });
    }));

  it('確定が競合して次の回に回っても、脱退する人の支出は作らない（確定の前でも、使えない人を選ばない）', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob'], { alice: { leaveRequestedMonth: '2026-11' } });
      await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([g.people.alice.memberId, g.people.bob.memberId]));
      await due(db, g); // 支払者は alice
      // 確定の書き込みが競合して失敗する(最初の batch)。確定は済まず、固定費はまだ止まっていない。
      const summary = await runScheduled(interferingEnv(env, bumpIn(db, g.groupId)), NOW_DECEMBER);
      assert.deepEqual(summary.deferredGroups, [g.groupId]);
      const state = await db.prepare('SELECT paused_at FROM recurring_expenses WHERE group_id = ?').bind(g.groupId).first<{ paused_at: number | null }>();
      assert.equal(state!.paused_at, null, '確定が済んでいないので、止まっていない');
      assert.equal((await expensesIn(db, g.groupId)).length, 0, 'それでも、脱退する人が支払者の支出は作らない');
    }));

  it('負担設定が合わない固定費（不整合）だけを飛ばして、同じグループのほかの固定費は作る。定期処理は、気づけるように失敗として投げる', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob']);
      const a = g.people.alice.memberId;
      const b = g.people.bob.memberId;
      const base = { groupId: g.groupId, categoryId: g.categoryId, payerMemberId: a, dayOfMonth: 5 };
      // 単独なのに、負担設定の行が無い。
      const noRows = await insertRecurringRow(db, { ...base, description: '行が無い', splitMethod: 'single' });
      // 金額指定の合計が、金額（80000）と合わない。
      const mismatch = await insertRecurringRow(db, { ...base, description: '合計が違う', splitMethod: 'fixed', allocations: [[a, null, 1000], [b, null, 1000]] });
      await insertRecurringRow(db, { ...base, description: '正常' });

      const direct = await registerDueRecurring(db, NOW, 0, 1000);
      assert.deepEqual([...direct.invalidTemplates].sort(), [mismatch, noRows].sort());
      assert.deepEqual(direct.failedGroups, [], 'グループの失敗にはしない');
      assert.deepEqual(direct.createdGroups, [g.groupId]);
      assert.deepEqual((await expensesIn(db, g.groupId)).map((expense) => expense.description), ['正常']);

      // 定期処理は、毎回、失敗として投げる（直るまで気づける）。正常な固定費は、二重に作らない。
      await assert.rejects(runScheduled(env, NOW + 3_600_000), /作れなかった固定費がある: 2件/);
      assert.equal((await expensesIn(db, g.groupId)).length, 1);
    }));

  it('定期処理の入口（scheduled）から動く。要約に、作ったグループと数が入る', () =>
    isolated(async ({ db, env, factory }) => {
      const g = await factory.createGroup(['alice', 'bob']);
      await due(db, g);
      await worker.scheduled({ scheduledTime: NOW, cron: '0 * * * *', noRetry() {} }, env);
      assert.equal((await expensesIn(db, g.groupId)).length, 1);

      const second = await factory.createGroup(['alice', 'bob']);
      await due(db, second);
      const summary = await runScheduled(env, NOW + 3_600_000);
      assert.deepEqual(summary.recurring.createdGroups, [second.groupId]);
      assert.equal(summary.recurring.createdExpenses, 1);
      assert.equal(summary.recurring.skipped, false);
      assert.deepEqual(summary.confirmedGroups, []);
    }));
});
