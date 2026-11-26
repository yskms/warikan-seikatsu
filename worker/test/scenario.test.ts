/// <reference types="node" />
// 統合テスト（docs/backend-design.md 13章の8）: 招待 → 参加 → 支出（再送を含む）→ 月締め → 繰越 → 脱退 → 精算 →
// 脱退済み、までを、実際のAPIの呼び出しだけで1本につないで検査する。各APIの規則は、それぞれのテストで見ている。
// ここで見るのは、APIをまたいだつながり（参加した月の割合が、そのあとの集計・締めに効く。繰越が翌月の締めに入る。
// 脱退の確定が、翌月の割合・支出の登録・精算に効く。Cronは、すでに済んだ状態を変えない）。
// DBの状態は、SQLで直接作らない（グループ・メンバー・費目・10月の割合だけ、APIが無いのでSQLで作る）。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { runScheduled } from '../src/cron.ts';
import { handleCreateExpense, handleListExpenses } from '../src/expenses.ts';
import { createFixtureFactory, equalShares, insertCategoryRule, NOW, type Person } from './apiFixture.ts';
import { groupsApi } from './groupsApi.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { membershipApi } from './membershipApi.ts';
import { monthApi, NOW_DECEMBER, read, request } from './monthApi.ts';

describe('統合テスト: 招待から脱退・精算まで', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    env = local.env;
  });
  after(async () => {
    await local.dispose();
  });

  const dataVersion = async (groupId: string) =>
    (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
      .data_version;
  const memberStatus = async (memberId: string) =>
    (await db.prepare('SELECT status FROM group_members WHERE id = ?').bind(memberId).first<{ status: string }>())!.status;

  it('3人の1か月（10月・11月）と、脱退した人の精算', async () => {
    const factory = createFixtureFactory(db);
    const members = membershipApi(env);
    const months = monthApi(env);
    const g = await factory.createGroup(['alice', 'bob']);
    const { alice, bob } = g.people;
    await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares([alice.memberId, bob.memberId]));

    // 登録の識別子（UUID）は、ラベルごとに1つ。同じラベルで登録すると、同じ登録の再送になる。
    const registrationIds = new Map<string, string>();
    const register = async (who: Person, payer: Person, amountMinor: number, targetMonth: string, label: string, now = NOW) =>
      read(
        await handleCreateExpense(
          request('POST', `/groups/${g.groupId}/expenses`, who.token, {
            id: registrationIds.get(label) ?? registrationIds.set(label, crypto.randomUUID()).get(label),
            expenseDate: '2026-11-19',
            targetMonth,
            amountMinor,
            categoryId: g.categoryId,
            payerMemberId: payer.memberId,
            split: { method: 'category' },
          }),
          env,
          now,
          g.groupId,
        ),
      );
    const list = async (who: Person, month: string, now = NOW) =>
      read(
        await handleListExpenses(request('GET', `/groups/${g.groupId}/expenses?month=${month}`, who.token), env, now, g.groupId),
      );

    // --- 1. 招待して、carol が11月に参加する --------------------------------------------------------
    const carolUser = await factory.addUser('carol');
    const invite = (await members.createInvite(alice, g.groupId)).body.invite;
    // URLを開いただけでは参加しない。
    assert.equal((await members.getInvite(carolUser, invite.token)).body.alreadyMember, false);
    const joined = await members.join(carolUser, invite.token, { displayName: 'carol' });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
    const carol: Person = { ...carolUser, memberId: joined.body.memberId };
    // 2人のグループへの参加なので、今の割合（2人の均等）は変えず、carol は0%で入る。お知らせの印は「0%で足した」（joined）。
    const afterJoin = await groupsApi(env).getRules(alice, g.groupId, '2026-11');
    assert.deepEqual(
      afterJoin.body.categories[0].shares.map((s: { memberId: string; basisPoints: number }) => [s.memberId === carol.memberId, s.basisPoints]).sort(),
      [[false, 5000], [false, 5000], [true, 0]],
    );
    assert.equal(afterJoin.body.categories[0].memberChangeKind, 'joined');
    // 3人で分けたいので、「全費目を均等にする」を押す（割合を直す操作と同じ権限。印も消える）。
    assert.equal((await groupsApi(env).resetSharesToEqual(alice, g.groupId, { month: '2026-11' })).status, 204);
    assert.equal((await groupsApi(env).getRules(alice, g.groupId, '2026-11')).body.categories[0].memberChangedAt, null);

    // --- 2. 10月の支出（alice が6,000、bob が2,000）。同じ登録の再送は、2件にならない -----------------
    const first = await register(alice, alice, 6000, '2026-10', 'oct-1');
    assert.equal(first.status, 201);
    assert.equal((await register(alice, alice, 6000, '2026-10', 'oct-1')).status, 200, '再送');
    assert.equal((await register(bob, bob, 2000, '2026-10', 'oct-2')).status, 201);
    assert.equal((await list(bob, '2026-10')).body.expenses.length, 2);

    // 11月から参加した carol は、10月には登録できず、10月を見られない。
    assert.equal((await register(carol, carol, 1000, '2026-10', 'oct-3')).status, 409);
    assert.equal((await list(carol, '2026-10')).status, 403);

    // --- 3. 10月を締める。bob → alice の2,000円。bob が11月に繰り越す ------------------------------
    const october = await months.close(bob, g.groupId, '2026-10');
    assert.equal(october.status, 201, JSON.stringify(october.body));
    assert.deepEqual(
      october.body.transfers.map((t: { fromMemberId: string; toMemberId: string; amountMinor: number }) => [t.fromMemberId, t.toMemberId, t.amountMinor]),
      [[bob.memberId, alice.memberId, 2000]],
    );
    // 10月が締まったので、10月の支出は直せない（登録できる月は11月だけ）。
    assert.equal((await register(alice, alice, 100, '2026-10', 'oct-4')).status, 409);
    assert.equal((await months.carry(alice, october.body.transfers[0].id)).status, 200);

    // --- 4. 11月: carol が9,000円を立て替える。割合は、参加のあとに均等にした3人、繰越は締めで加わる ------
    // 参加したメンバーのIDはUUIDなので、端数を配る固定順（IDの昇順）の先頭が誰になるかは決まらない。
    // 端数の配り方は settlement.test.ts で見ているので、ここでは、つながりを、順序に依らない形で見る。
    type MemberView = { memberId: string; paidMinor: number; burdenMinor: number; carriedInMinor: number; netMinor: number };
    const byMember = (rows: MemberView[]) => new Map(rows.map((row) => [row.memberId, row]));
    assert.equal((await register(carol, carol, 9000, '2026-11', 'nov-1')).status, 201);
    const preview = (await months.summary(alice, g.groupId, '2026-11')).body;
    const view = byMember(preview.members);
    assert.equal(preview.members.length, 3, 'carol は、参加した月（11月）から集計に入る');
    assert.equal(view.get(carol.memberId)!.paidMinor, 9000);
    for (const person of [alice, bob, carol]) {
      // 負担額は、3人の均等（9,000円の3分の1、端数は1円）。
      assert.ok(Math.abs(view.get(person.memberId)!.burdenMinor - 3000) <= 1, person.memberId);
    }
    // 10月の繰越（bob → alice の2,000円）は、負担額に入らず、精算する額にだけ入る。
    assert.deepEqual(
      [alice, bob, carol].map((person) => view.get(person.memberId)!.carriedInMinor),
      [2000, -2000, 0],
    );
    assert.equal(
      preview.members.reduce((total: number, m: MemberView) => total + m.netMinor, 0),
      0,
      '全員の精算する額の合計はゼロ',
    );

    // --- 5. carol が「今月で脱退する」。11月を締めると、脱退が確定する ------------------------------
    assert.equal((await members.requestLeave(carol, g.groupId)).status, 200);
    assert.equal(await memberStatus(carol.memberId), 'active', '選んだだけでは確定しない');
    const november = await months.close(alice, g.groupId, '2026-11');
    assert.equal(november.status, 201, JSON.stringify(november.body));
    // 締めた結果は、直前の見込みと同じ。
    assert.deepEqual(november.body.members, preview.members);
    assert.equal(await memberStatus(carol.memberId), 'leaving', '月を締めて確定した。送金が残っているので、脱退済みではない');
    // 送金の合計は、alice・bob それぞれの精算する額と一致する（どちらも carol への支払い）。
    const transfers: { id: string; fromMemberId: string; toMemberId: string; amountMinor: number; canCarry: boolean }[] =
      november.body.transfers;
    assert.equal(transfers.length, 2);
    for (const person of [alice, bob]) {
      const sent = transfers.filter((t) => t.fromMemberId === person.memberId && t.toMemberId === carol.memberId);
      assert.deepEqual(
        sent.map((t) => t.amountMinor),
        [-view.get(person.memberId)!.netMinor],
      );
    }

    // 確定した carol は、見られるが、書けない。取り消せない。送金の受取側として、繰り越せない。
    assert.equal((await list(carol, '2026-11')).status, 200);
    assert.equal((await register(carol, carol, 100, '2026-12', 'dec-0')).status, 403);
    assert.equal((await members.cancelLeave(carol, g.groupId)).body.error, 'leave_confirmed');
    assert.deepEqual(
      transfers.map((t) => t.canCarry),
      [false, false],
    );
    const toCarol = transfers;
    assert.equal((await months.carry(alice, toCarol[0]!.id)).body.error, 'transfer_not_carryable');

    // --- 6. 11月を早めに締めたので、同じ暦月の日付の支出を12月分として登録できる。carol は割合から外れている ----
    assert.equal((await register(alice, alice, 4000, '2026-12', 'dec-1')).status, 201);
    assert.equal((await register(alice, carol, 100, '2026-12', 'dec-2')).body.error, 'member_not_available');
    const december = (await months.summary(alice, g.groupId, '2026-12', { now: NOW_DECEMBER })).body;
    assert.deepEqual(
      december.members.map((m: { memberId: string; burdenMinor: number }) => [m.memberId, m.burdenMinor]),
      [
        [alice.memberId, 2000],
        [bob.memberId, 2000],
      ],
      '12月の集計に carol は入らない（割合は、脱退の確定で2人の均等に戻っている）',
    );

    // --- 7. 精算: 1件目では脱退済みにならず、2件目で脱退済みになる。Cronは、済んだ状態を変えない -----------
    assert.equal((await months.settle(carol, toCarol[0]!.id)).status, 200);
    assert.equal(await memberStatus(carol.memberId), 'leaving');
    assert.equal((await months.settle(bob, toCarol[1]!.id)).status, 200);
    assert.equal(await memberStatus(carol.memberId), 'left');
    assert.equal((await months.closing(bob, g.groupId, '2026-11')).body.closing.processed, true);

    const version = await dataVersion(g.groupId);
    const cron = await runScheduled(env, NOW_DECEMBER);
    assert.equal(cron.confirmedGroups.includes(g.groupId), false);
    assert.equal(await dataVersion(g.groupId), version, 'Cronは、すでに済んだグループを書き換えない');

    // 脱退済みの carol には、グループがあることも教えない。締めた結果に、名前は残る。
    assert.equal((await list(carol, '2026-11')).status, 404);
    assert.equal((await months.summary(carol, g.groupId, '2026-11')).status, 404);
    const names = (await months.closing(alice, g.groupId, '2026-11')).body.members.map((m: { displayName: string }) => m.displayName);
    assert.ok(names.includes('carol'));
  });
});
