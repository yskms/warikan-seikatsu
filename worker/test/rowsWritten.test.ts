/// <reference types="node" />
// 1回の操作が読む行数・書く行数（ローカルD1の `meta.rows_read`・`meta.rows_written`）を測り、固定する。
// Freeの日次の上限（D1の読み取り500万行・書き込み10万行。docs/backend-design.md 12章「Freeのまま運用するときの上限」）に対する、
// 操作ごとの費用の実測。1日に使える人数の見積もりは、12章。
//
// - ローカルD1の `rows_written` は、索引の更新も1行と数える（最初の検査）。本番の課金の数え方（公式の料金のページ）と同じはずだが、
//   本番での一致は、確かめていない（13章の9）。違うと、ここの数は過小になる。
// - 数字は、このテストが用意するデータでの値。行数は、操作ごとに決まる部分（書く行数）と、データの量で増える部分（読む行数。
//   一覧・集計は、その月の支出の数に比例する）がある。後者は、今月30件・100件の2通りで見る。
// - 索引・列・書き込みの文を足すと、この数が変わる。変わったら、意味を確かめて（書く行数が増える変更は、日次の上限に効く）、
//   数字とdocs 12章を更新する。
// - 測らなかったもの: CPU時間（デプロイが要る。13章の9）、本番D1の実際の課金（ローカルの数え方との一致は、最初の検査まで）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { deleteAccount as deleteAccountData } from '../src/accountDeletion.ts';
import { runScheduled } from '../src/cron.ts';
import { handleCreateExpense, handleDeleteExpense, handleListExpenses, handleUpdateExpense } from '../src/expenses.ts';
import { resolveIdentity } from '../src/identity.ts';
import type { IdTokenVerifier } from '../src/idToken.ts';
import { signIn } from '../src/login.ts';
import { issueNonce } from '../src/nonce.ts';
import { registerDueRecurring } from '../src/recurringRun.ts';
import { authenticateSession, createSession, revokeSession } from '../src/session.ts';
import {
  createFixtureFactory,
  equalShares,
  insertCategoryRule,
  insertClosing,
  insertExpenseRow,
  insertRecurringRow,
  NOW,
  type Person,
} from './apiFixture.ts';
import { groupsApi } from './groupsApi.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { monthApi, NOW_DECEMBER, read, request } from './monthApi.ts';
import { meteredEnv } from './rowsMeter.ts';

const SECRET = 'test-secret-value-0123456789abcdef';
const VALID_GROUP = { name: 'ふたりの生活費', displayName: 'owner', timezone: 'Asia/Tokyo' };
/** 2026-11-25 00:30（Asia/Tokyo）。固定費の予定日（25日）を過ぎた直後。 */
const NOV_25_0030_JST = Date.UTC(2026, 10, 24, 15, 30, 0);

/** 操作の名前 → [読んだ行数, 書いた行数]。 */
type Table = Record<string, [read: number, written: number]>;

describe('1回の操作の、読む行数・書く行数', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  const table: Table = {};

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = { ...local.env, NONCE_HMAC_KEY: SECRET, APPLE_BUNDLE_ID: 'x', GOOGLE_WEB_CLIENT_ID: 'y' } as unknown as Env;
    factory = createFixtureFactory(db);
  });
  after(async () => {
    await local.dispose();
  });

  /** 操作を、数えるDBで実行し、`table` に記録する。API の応答なら、成功（400未満）でなければ測定が無効なので、落とす。 */
  async function measure<T>(name: string, operation: (metered: Env) => Promise<T>): Promise<T> {
    assert.equal(name in table, false, `${name} を二重に測った`);
    const metered = meteredEnv(env);
    const result = await operation(metered.env);
    const status = (result as { status?: unknown } | null)?.status;
    if (typeof status === 'number') assert.ok(status < 400, `${name}: ${status} ${JSON.stringify((result as { body?: unknown }).body)}`);
    table[name] = [metered.totals.read, metered.totals.written];
    return result;
  }

  interface Built {
    groupId: string;
    owner: Person;
    people: Person[];
    categoryIds: string[];
  }
  /** APIで作ったグループ（POST /groups と、招待・参加）。費目は初期の7つに `extraCategories` を足す。 */
  async function buildGroup(members: number, extraCategories = 0): Promise<Built> {
    const owner = await factory.addUser('owner');
    const created = await groupsApi(env).createGroup(owner, VALID_GROUP);
    assert.equal(created.status, 201);
    const groupId = created.body.group.id as string;
    const people: Person[] = [{ ...owner, memberId: created.body.group.memberId as string }];
    for (let i = 1; i < members; i++) {
      const person = await factory.addUser(`m${i}`);
      const invite = await membershipApi(env).createInvite(owner, groupId);
      const joined = await membershipApi(env).join(person, invite.body.invite.token, { displayName: `m${i}` });
      assert.equal(joined.status, 201);
      people.push({ ...person, memberId: joined.body.memberId as string });
    }
    for (let i = 0; i < extraCategories; i++) {
      const added = await groupsApi(env).createCategory(owner, groupId, { name: `c${i}`, icon: 'game', color: 'red' });
      assert.equal(added.status, 201);
    }
    const categories = await groupsApi(env).listCategories(owner, groupId);
    return { groupId, owner, people, categoryIds: categories.body.categories.map((c: { id: string }) => c.id) };
  }

  const stubVerifier = (sub: string) =>
    ({
      verify: async () => ({ ok: true, sub }),
      verifyAppleNotification: async () => ({ ok: false, reason: 'malformed' }),
    }) as unknown as IdTokenVerifier;

  it('ローカルD1の rows_written は、索引の更新も1行と数える（本番の課金の数え方と同じはず。本番での一致は13章の9で確かめる）', async () => {
    const rowsWritten = async (sql: string) => (await db.prepare(sql).run()).meta.rows_written;
    // users: 索引なし → 1。identities（WITHOUT ROWID）: 表1 + UNIQUE(provider, sub) 1 + idx_identities_user_id 1 → 3。
    // sessions: 表1 + idx_sessions_identity_id 1 → 2。
    assert.equal(await rowsWritten("INSERT INTO users (id, created_at, last_active_at) VALUES ('count-u', 1, 1)"), 1);
    assert.equal(
      await rowsWritten(
        "INSERT INTO identities (id, user_id, provider, sub, created_at, last_sign_in_at) VALUES ('count-i', 'count-u', 'google', 'count-s', 1, 1)",
      ),
      3,
    );
    assert.equal(
      await rowsWritten("INSERT INTO sessions (token_hash, identity_id, created_at, last_used_at) VALUES ('count-t', 'count-i', 1, 1)"),
      2,
    );
    // 索引に入っていない列の更新は、表の1行だけ。索引に入っている列の更新は、（同じ値でも）索引の分も書く。
    assert.equal(await rowsWritten("UPDATE sessions SET last_used_at = 2 WHERE token_hash = 'count-t'"), 1);
    assert.equal(await rowsWritten("UPDATE sessions SET identity_id = 'count-i' WHERE token_hash = 'count-t'"), 2);
    await db.prepare("DELETE FROM users WHERE id = 'count-u'").run();
  });

  it('操作ごとの行数（認証・グループ・支出・月締め・固定費・Cron・削除・画面の読み込み）', async () => {
    // ---- 認証
    const t1 = (await issueNonce(SECRET, { kind: 'native' }, NOW)).nonce;
    await measure('ログイン（初回。ユーザー・ログイン手段・セッションを作る）', (e) =>
      signIn(e, stubVerifier('rows-sub-1'), { provider: 'google', kind: 'native', nonce: t1, idToken: 'x' }, NOW),
    );
    const t2 = (await issueNonce(SECRET, { kind: 'native' }, NOW)).nonce;
    await measure('ログイン（2回目以降）', (e) =>
      signIn(e, stubVerifier('rows-sub-1'), { provider: 'google', kind: 'native', nonce: t2, idToken: 'x' }, NOW),
    );
    const identity = await resolveIdentity(db, 'google', 'rows-sub-2', NOW - 100);
    const fresh = (await createSession(db, identity.identityId, NOW - 1000))!;
    await measure('認証だけ（最後の利用から24時間未満。書かない）', (e) => authenticateSession(e.DB, fresh, NOW));
    const old = (await createSession(db, identity.identityId, NOW - 25 * 3600_000))!;
    await measure('認証だけ（24時間以上たっていて、最後に使った時刻を更新する）', (e) => authenticateSession(e.DB, old, NOW));
    await measure('ログアウト', (e) => revokeSession(e.DB, old, NOW));

    // ---- グループ・招待・参加
    const solo = await factory.addUser('creator');
    await measure('グループの作成（費目7）', (e) => groupsApi(e).createGroup(solo, VALID_GROUP));
    const one = await buildGroup(1);
    const invite = await measure('招待の発行', (e) => membershipApi(e).createInvite(one.owner, one.groupId));
    const second = await factory.addUser('second');
    await measure('参加（1人のグループに2人目。費目7）', (e) =>
      membershipApi(e).join(second, invite.body.invite.token, { displayName: 'second' }),
    );
    const four = await buildGroup(4);
    const inviteFifth = await membershipApi(env).createInvite(four.owner, four.groupId);
    const fifth = await factory.addUser('fifth');
    await measure('参加（4人のグループに5人目。費目7）', (e) =>
      membershipApi(e).join(fifth, inviteFifth.body.invite.token, { displayName: 'fifth' }),
    );

    // ---- 支出・費目
    const pair = await buildGroup(2);
    const five = await buildGroup(5);
    const expenseBody = (g: Built, extra: Record<string, unknown> = {}) => ({
      expenseDate: '2026-11-19',
      targetMonth: '2026-11',
      description: 'スーパー',
      amountMinor: 4280,
      categoryId: g.categoryIds[1],
      payerMemberId: g.people[0]!.memberId,
      split: { method: 'category' },
      ...extra,
    });
    const create = (g: Built, extra: Record<string, unknown> = {}) => (e: Env) =>
      handleCreateExpense(request('POST', `/groups/${g.groupId}/expenses`, g.owner.token, expenseBody(g, extra)), e, NOW, g.groupId).then(
        read,
      );
    const equal = (g: Built) => ({ split: { method: 'equal', memberIds: g.people.map((p) => p.memberId) } });
    const registered = await measure('支出の登録（2人・費目の割合）', create(pair));
    await measure('支出の登録（5人・費目の割合）', create(five));
    await measure('支出の登録（2人・均等）', create(pair, equal(pair)));
    await measure('支出の登録（5人・均等）', create(five, equal(five)));
    const expenseId = registered.body.expense.id as string;
    await measure('支出の編集（金額を変える）', (e) =>
      handleUpdateExpense(request('PATCH', `/expenses/${expenseId}`, pair.owner.token, { amountMinor: 5000 }), e, NOW, expenseId).then(read),
    );
    await measure('支出の削除', (e) =>
      handleDeleteExpense(request('DELETE', `/expenses/${expenseId}`, pair.owner.token), e, NOW, expenseId).then(read),
    );
    await measure('費目の追加（2人）', (e) => groupsApi(e).createCategory(pair.owner, pair.groupId, { name: '趣味', icon: 'game', color: 'red' }));
    await measure('費目の追加（5人）', (e) => groupsApi(e).createCategory(five.owner, five.groupId, { name: '趣味', icon: 'game', color: 'red' }));

    // ---- 月締め・精算（各費目に支出が1件ずつある月）
    const seedMonth = async (g: Built, month: string) => {
      for (const categoryId of g.categoryIds) {
        await insertExpenseRow(db, { groupId: g.groupId, categoryId, payerMemberId: g.people[0]!.memberId, amountMinor: 3000, targetMonth: month });
      }
    };
    const settleAll = async (g: Built, transfers: { id: string }[]) => {
      for (const transfer of transfers) assert.equal((await monthApi(env).settle(g.owner, transfer.id)).status, 200);
    };
    const closing = async (name: string, g: Built, month: string, now: number) => {
      await seedMonth(g, month);
      return measure(name, (e) => monthApi(e).close(g.owner, g.groupId, month, { now }));
    };
    const smallGroup = await buildGroup(2);
    const smallFirst = await closing('月締め（2人・費目7。最初の月）', smallGroup, '2026-11', NOW);
    await measure('精算（送金1件を精算済みにする）', (e) => monthApi(e).settle(smallGroup.owner, smallFirst.body.transfers[0].id));
    await settleAll(smallGroup, smallFirst.body.transfers.slice(1));
    await closing('月締め（2人・費目7。次の月。割合の行を引き継ぐ）', smallGroup, '2026-12', NOW_DECEMBER);
    const fiveFirst = await closing('月締め（5人・費目7。最初の月）', await buildGroup(5), '2026-11', NOW);
    void fiveFirst;
    const big = await buildGroup(5, 23);
    const bigFirst = await closing('月締め（5人・費目30。最初の月）', big, '2026-11', NOW);
    await settleAll(big, bigFirst.body.transfers);
    await closing('月締め（5人・費目30。次の月。割合の行を引き継ぐ）', big, '2026-12', NOW_DECEMBER);

    // ---- 固定費の自動登録・Cron
    const recurring = await factory.createGroup(['alice', 'bob']);
    const pairIds = [recurring.people.alice.memberId, recurring.people.bob.memberId];
    await insertCategoryRule(db, recurring.groupId, recurring.categoryId, '2026-11', equalShares(pairIds));
    for (let i = 0; i < 10; i++) {
      await insertRecurringRow(db, { groupId: recurring.groupId, categoryId: recurring.categoryId, payerMemberId: pairIds[0]!, dayOfMonth: 25 });
    }
    const registeredSummary = await measure('固定費の自動登録（10件を作る。2人・費目の割合）', (e) =>
      registerDueRecurring(e.DB, NOV_25_0030_JST, 0, 1000),
    );
    assert.equal(registeredSummary.createdExpenses, 10);
    const idle = await factory.createGroup(['alice', 'bob']);
    await insertCategoryRule(db, idle.groupId, idle.categoryId, '2026-11', equalShares([idle.people.alice.memberId, idle.people.bob.memberId]));
    for (let i = 0; i < 100; i++) {
      await insertRecurringRow(db, { groupId: idle.groupId, categoryId: idle.categoryId, payerMemberId: idle.people.alice.memberId, dayOfMonth: 28 });
    }
    await measure('Cronの毎時の実行（固定費が計110件。予定日前で、何も作らない）', (e) => runScheduled(e, NOW, 1000));

    // ---- アカウント削除（データ処理だけ）
    const leaving = await buildGroup(2);
    await measure('アカウントの削除（データ処理。2人のグループ1つから抜ける）', (e) => deleteAccountData(e.DB, leaving.people[1]!.userId, NOW));
    const alone = await buildGroup(1);
    await measure('アカウントの削除（データ処理。自分だけのグループ1つを消す）', (e) => deleteAccountData(e.DB, alone.people[0]!.userId, NOW));

    // ---- 画面の読み込み（先月60件は締め済み。今月は30件、そのあと100件）
    const screens = await factory.createGroup(['alice', 'bob']);
    const members = [screens.people.alice.memberId, screens.people.bob.memberId];
    const categories = [screens.categoryId];
    for (let i = 0; i < 7; i++) categories.push(await factory.addCategory(screens.groupId, `c${i}`));
    for (const month of ['2026-10', '2026-11']) {
      for (const categoryId of categories) await insertCategoryRule(db, screens.groupId, categoryId, month, equalShares(members));
    }
    const seed = async (month: string, count: number) => {
      for (let i = 0; i < count; i++) {
        await insertExpenseRow(db, {
          groupId: screens.groupId,
          categoryId: categories[i % categories.length]!,
          payerMemberId: members[i % 2]!,
          amountMinor: 1000 + i,
          targetMonth: month,
        });
      }
    };
    await seed('2026-10', 60);
    await insertClosing(db, screens.groupId, '2026-10', members[0]!);
    const alice = screens.people.alice;
    const openScreens = async (label: string) => {
      await measure(`${label}: グループの一覧`, (e) => groupsApi(e).listGroups(alice));
      await measure(`${label}: グループの詳細`, (e) => groupsApi(e).getGroup(alice, screens.groupId));
      await measure(`${label}: 月の一覧`, (e) => monthApi(e).months(alice, screens.groupId));
      await measure(`${label}: 費目の一覧`, (e) => groupsApi(e).listCategories(alice, screens.groupId));
      await measure(`${label}: 費目の負担割合`, (e) => groupsApi(e).getRules(alice, screens.groupId, '2026-11'));
      await measure(`${label}: 今月の支出の一覧`, (e) =>
        handleListExpenses(request('GET', `/groups/${screens.groupId}/expenses?month=2026-11`, alice.token), e, NOW, screens.groupId).then(read),
      );
      await measure(`${label}: 今月の集計（summary）`, (e) => monthApi(e).summary(alice, screens.groupId, '2026-11'));
    };
    await seed('2026-11', 30);
    await openScreens('今月30件');
    await seed('2026-11', 70);
    await openScreens('今月100件');

    // 書く行数は、実行ごとに同じ（厳密に比べる）。読む行数は、IDの並び（UUID）で数行ぶれるので、±10%（と5行）の幅で比べる。
    const hint = `実測が変わった。意味を確かめて、EXPECTED と docs/backend-design.md 12章を直す:\n${JSON.stringify(table, null, 2)}`;
    assert.deepEqual(Object.keys(table), Object.keys(EXPECTED), hint);
    for (const [name, [expectedRead, expectedWritten]] of Object.entries(EXPECTED)) {
      const [actualRead, actualWritten] = table[name]!;
      assert.equal(actualWritten, expectedWritten, `${name}: 書く行数。${hint}`);
      assert.ok(Math.abs(actualRead - expectedRead) <= expectedRead * 0.1 + 5, `${name}: 読む行数 ${actualRead}（期待 ${expectedRead}）。${hint}`);
    }
  });
});

/** 実測（[読んだ行数, 書いた行数]）。書く行数は厳密、読む行数は目安（実行ごとに数行ぶれる）。 */
const EXPECTED: Table = {
  'ログイン（初回。ユーザー・ログイン手段・セッションを作る）': [8, 7],
  'ログイン（2回目以降）': [9, 3],
  '認証だけ（最後の利用から24時間未満。書かない）': [2, 0],
  '認証だけ（24時間以上たっていて、最後に使った時刻を更新する）': [4, 2],
  'ログアウト': [4, 1],
  'グループの作成（費目7）': [17, 54],
  '招待の発行': [8, 4],
  '参加（1人のグループに2人目。費目7）': [57, 62],
  '参加（4人のグループに5人目。費目7）': [106, 125],
  '支出の登録（2人・費目の割合）': [13, 4],
  '支出の登録（5人・費目の割合）': [16, 4],
  '支出の登録（2人・均等）': [15, 8],
  '支出の登録（5人・均等）': [21, 14],
  '支出の編集（金額を変える）': [15, 3],
  '支出の削除': [12, 2],
  '費目の追加（2人）': [29, 10],
  '費目の追加（5人）': [32, 16],
  '月締め（2人・費目7。最初の月）': [130, 39],
  '精算（送金1件を精算済みにする）': [21, 2],
  '月締め（2人・費目7。次の月。割合の行を引き継ぐ）': [141, 83],
  '月締め（5人・費目7。最初の月）': [197, 96],
  '月締め（5人・費目30。最初の月）': [664, 326],
  '月締め（5人・費目30。次の月。割合の行を引き継ぐ）': [691, 688],
  '固定費の自動登録（10件を作る。2人・費目の割合）': [68, 51],
  'Cronの毎時の実行（固定費が計110件。予定日前で、何も作らない）': [351, 0],
  'アカウントの削除（データ処理。2人のグループ1つから抜ける）': [78, 35],
  'アカウントの削除（データ処理。自分だけのグループ1つを消す）': [126, 27],
  '今月30件: グループの一覧': [6, 0],
  '今月30件: グループの詳細': [8, 0],
  '今月30件: 月の一覧': [7, 0],
  '今月30件: 費目の一覧': [21, 0],
  '今月30件: 費目の負担割合': [112, 0],
  '今月30件: 今月の支出の一覧': [97, 0],
  '今月30件: 今月の集計（summary）': [155, 0],
  '今月100件: グループの一覧': [6, 0],
  '今月100件: グループの詳細': [8, 0],
  '今月100件: 月の一覧': [7, 0],
  '今月100件: 費目の一覧': [21, 0],
  '今月100件: 費目の負担割合': [112, 0],
  '今月100件: 今月の支出の一覧': [307, 0],
  '今月100件: 今月の集計（summary）': [295, 0],
};
