// ホームに出す内容の組み立てのテスト。`npm test` で実行する。計算（負担・精算）は、ここでは確かめない
// （Workerだけが計算する）。応答の値を、表示する形にすることだけを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { Category, CloseState, Expense, MonthListItem, MonthMember, MonthView } from '../domain/month.ts';
import {
  buildBreakdown,
  buildExpenseRows,
  buildMemberBurdens,
  buildMonthOptions,
  buildNotices,
  buildSettlement,
  buildTotal,
  CARRY_BLOCKED_TEXT,
  carryConfirmText,
  closeBlockedText,
  initialOf,
  memberColumns,
  memberLookup,
  moneyFormatters,
  neighborMonths,
  settleConfirmText,
} from './homeView.ts';

const member = (id: string, displayName: string, color: string): GroupMember => ({
  id,
  displayName,
  color,
  status: 'active',
  historyFromMonth: '2026-10',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
  leaveEffective: false,
  isMe: id === 'm1',
});

const group: GroupDetail = {
  id: 'g1',
  name: 'ふたりの生活費',
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: 0,
  memberId: 'm1',
  currencyLocked: false,
  seatedMembers: 2,
  maxMembers: 5,
  canInvite: true,
  members: [member('m1', 'あなた', 'pink'), member('m2', '彼女', 'blue'), member('m3', '脱退した人', 'green')],
};

const { money, signed } = moneyFormatters(group);

const monthMember = (memberId: string, patch: Partial<MonthMember> = {}): MonthMember => ({
  memberId,
  displayName: memberId === 'm1' ? 'あなた' : '彼女',
  paidMinor: 0,
  burdenMinor: 0,
  differenceMinor: 0,
  carriedInMinor: 0,
  netMinor: 0,
  ...patch,
});

function view(patch: Partial<MonthView> = {}): MonthView {
  return {
    month: '2026-11',
    closed: false,
    closing: null,
    totalMinor: 128450,
    members: [monthMember('m1', { paidMinor: 100000, burdenMinor: 64225 }), monthMember('m2', { burdenMinor: 64225 })],
    categories: [],
    transfers: [],
    close: { closable: true },
    ...patch,
  };
}

const categories: Category[] = [
  { id: 'c1', name: '食費', icon: 'cart', color: 'green', sortOrder: 1, archived: false },
  { id: 'c2', name: '昔の費目', icon: 'home', color: 'blue', sortOrder: 2, archived: true },
];

describe('memberLookup', () => {
  it('グループのメンバー（脱退済みも）から名前と色を引く。知らないIDは既定', () => {
    const lookup = memberLookup(group);
    assert.equal(lookup.name('m3'), '脱退した人');
    assert.equal(lookup.color('m2'), 'blue');
    assert.equal(lookup.name('zzz'), '不明なメンバー');
    assert.equal(lookup.color('zzz'), 'gray');
  });

  it('月の集計の名前を優先する（締めた月は、締めた時点の名前）', () => {
    const lookup = memberLookup(group, { members: [monthMember('m2', { displayName: '旧名' })] });
    assert.equal(lookup.name('m2'), '旧名');
    assert.equal(lookup.name('m1'), 'あなた');
    assert.equal(lookup.color('m2'), 'blue');
  });
});

describe('initialOf', () => {
  it('名前の最初の1文字（コードポイント）', () => {
    assert.equal(initialOf('あなた'), 'あ');
    assert.equal(initialOf('  Taro'), 'T');
    assert.equal(initialOf('𠮷野'), '𠮷');
    assert.equal(initialOf('👩‍👩'), '👩');
    assert.equal(initialOf(''), '?');
    assert.equal(initialOf('   '), '?');
  });
});

describe('月の切り替え', () => {
  const months: MonthListItem[] = [
    { month: '2026-09', status: 'skipped' },
    { month: '2026-10', status: 'unsettled' },
    { month: '2026-11', status: 'open' },
    { month: '2026-12', status: 'open' },
  ];

  it('ピッカーは新しい月を上に並べ、状態の印と選択中を付ける', () => {
    const options = buildMonthOptions(months, '2026-11');
    assert.deepEqual(
      options.map((option) => [option.month, option.label, option.statusLabel, option.selected]),
      [
        ['2026-12', '2026年12月', '未締め', false],
        ['2026-11', '2026年11月', '未締め', true],
        ['2026-10', '2026年10月', '精算が残っています', false],
        ['2026-09', '2026年9月', '締めずに飛ばした月', false],
      ],
    );
    // 元の配列を並べ替えない
    assert.equal(months[0]?.month, '2026-09');
  });

  it('処理済みの月の印。知らない状態（サーバーが足した値）は、印を出さない', () => {
    assert.equal(buildMonthOptions([{ month: '2026-10', status: 'settled' }], '2026-10')[0]?.statusLabel, '処理済み');
    assert.equal(buildMonthOptions([{ month: '2026-10', status: 'unknown' }], '2026-10')[0]?.statusLabel, '');
  });

  it('前・次の月は、一覧の中だけ', () => {
    assert.deepEqual(neighborMonths(months, '2026-11'), { previous: '2026-10', next: '2026-12' });
    assert.deepEqual(neighborMonths(months, '2026-09'), { previous: null, next: '2026-10' });
    assert.deepEqual(neighborMonths(months, '2026-12'), { previous: '2026-11', next: null });
    assert.deepEqual(neighborMonths(months, '2030-01'), { previous: null, next: null });
    assert.deepEqual(neighborMonths([], '2026-11'), { previous: null, next: null });
  });
});

describe('お知らせ', () => {
  const NOT_CLOSED: CloseState = { closable: false, reason: 'previous_month_not_closed', month: '2026-10' };

  it('前の月が未締めで、サーバーが先に締めるよう求めているとき、その月へ移るお知らせを出す', () => {
    assert.deepEqual(
      buildNotices(
        '2026-11',
        [
          { month: '2026-10', status: 'open' },
          { month: '2026-11', status: 'open' },
        ],
        NOT_CLOSED,
      ),
      [{ kind: 'previous-open', month: '2026-10', message: '10月がまだ締められていません' }],
    );
  });

  it('前の月が未締めでも、この月を締められる（最初の月の例外）ときは出さない', () => {
    // 作成月（10月）に支出が無く、11月に最初の支出を登録したグループ。11月は、10月を締めずに締められる
    const months: MonthListItem[] = [
      { month: '2026-10', status: 'open' },
      { month: '2026-11', status: 'open' },
    ];
    assert.deepEqual(buildNotices('2026-11', months, { closable: true }), []);
  });

  it('前の月が未締めでも、先に締めるよう求められていない理由のときは出さない', () => {
    const months: MonthListItem[] = [{ month: '2026-10', status: 'open' }];
    for (const reason of ['forbidden', 'month_not_started', 'month_skipped', 'month_closed', 'unknown'] as const) {
      assert.deepEqual(buildNotices('2026-11', months, { closable: false, reason, month: null }), [], reason);
    }
  });

  it('前の月の送金が未処理なら、精算が残っているお知らせを出す', () => {
    assert.deepEqual(
      buildNotices(
        '2026-11',
        [
          { month: '2026-10', status: 'unsettled' },
          { month: '2026-11', status: 'open' },
        ],
        { closable: false, reason: 'previous_month_unsettled', month: '2026-10' },
      ),
      [{ kind: 'previous-unsettled', month: '2026-10', message: '10月分の精算が残っています' }],
    );
  });

  it('年をまたぐ（1月の前の月は、前の年の12月）', () => {
    const notices = buildNotices('2027-01', [{ month: '2026-12', status: 'open' }], {
      closable: false,
      reason: 'previous_month_not_closed',
      month: '2026-12',
    });
    assert.equal(notices[0]?.month, '2026-12');
    assert.equal(notices[0]?.message, '12月がまだ締められていません');
  });

  it('処理済み・締めずに飛ばした月・知らない状態・一覧に無い月では出さない', () => {
    for (const status of ['settled', 'skipped', 'unknown'] as const) {
      assert.deepEqual(buildNotices('2026-11', [{ month: '2026-10', status }], NOT_CLOSED), [], status);
    }
    assert.deepEqual(buildNotices('2026-11', [{ month: '2026-11', status: 'open' }], NOT_CLOSED), []);
    assert.deepEqual(buildNotices('2026-11', [], NOT_CLOSED), []);
    assert.deepEqual(buildNotices('bad', [{ month: '2026-10', status: 'open' }], NOT_CLOSED), []);
  });
});

describe('総額・メンバー別の負担額', () => {
  it('総額は、月の見出しと金額。締めた月だけ印を付ける', () => {
    assert.deepEqual(buildTotal(view(), money), {
      title: '2026年11月の共同支出',
      amountText: '¥128,450',
      closedBadge: null,
    });
    assert.equal(buildTotal(view({ closed: true }), money).closedBadge, '締め済み');
  });

  it('メンバー別は、集計の順に、頭文字・色・負担額（繰越を含めない）', () => {
    const items = buildMemberBurdens(view(), memberLookup(group), money);
    assert.deepEqual(
      items.map((item) => [item.memberId, item.name, item.initial, item.color, item.burdenText]),
      [
        ['m1', 'あなた', 'あ', 'pink', '¥64,225'],
        ['m2', '彼女', '彼', 'blue', '¥64,225'],
      ],
    );
  });

  it('負担額が0のメンバーも出す', () => {
    const items = buildMemberBurdens(view({ members: [monthMember('m1')] }), memberLookup(group), money);
    assert.equal(items[0]?.burdenText, '¥0');
  });

  it('列数は、3人までは人数分、4人は2列、5人以上は3列', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(memberColumns), [1, 1, 2, 3, 2, 3, 3]);
  });
});

describe('内訳', () => {
  it('メンバーごとの支払額・負担額・差額・繰越と、費目ごとの合計・負担額', () => {
    const summary = view({
      members: [
        monthMember('m1', { paidMinor: 10000, burdenMinor: 7000, differenceMinor: 3000, carriedInMinor: 500 }),
        monthMember('m2', { paidMinor: 4000, burdenMinor: 7000, differenceMinor: -3000, carriedInMinor: -500 }),
      ],
      categories: [
        { categoryId: 'c1', totalMinor: 14000, burdens: [{ memberId: 'm1', burdenMinor: 7000 }, { memberId: 'm2', burdenMinor: 7000 }] },
        { categoryId: 'zzz', totalMinor: 100, burdens: [{ memberId: 'm2', burdenMinor: 100 }] },
      ],
    });
    const breakdown = buildBreakdown(summary, memberLookup(group), categories, { money, signed });
    assert.deepEqual(breakdown.members[0], {
      memberId: 'm1',
      name: 'あなた',
      paidText: '¥10,000',
      burdenText: '¥7,000',
      differenceText: '+¥3,000',
      carriedInText: '+¥500',
    });
    assert.equal(breakdown.members[1]?.differenceText, '-¥3,000');
    assert.equal(breakdown.members[1]?.carriedInText, '-¥500');
    assert.equal(breakdown.categories[0]?.name, '食費');
    assert.equal(breakdown.categories[0]?.totalText, '¥14,000');
    assert.deepEqual(breakdown.categories[0]?.burdens.map((b) => [b.name, b.burdenText]), [['あなた', '¥7,000'], ['彼女', '¥7,000']]);
    // 費目の一覧に無い費目は、名前と見た目を既定にする
    assert.equal(breakdown.categories[1]?.name, '不明な費目');
    assert.equal(breakdown.categories[1]?.color, 'gray');
  });

  it('繰越が0なら、繰越を出さない', () => {
    const breakdown = buildBreakdown(view(), memberLookup(group), categories, { money, signed });
    assert.equal(breakdown.members[0]?.carriedInText, null);
  });
});

describe('精算（締める前の見込み）', () => {
  const lookup = memberLookup(group);

  it('送金を、向きと金額で出す。IDも状態も無い', () => {
    const model = buildSettlement(
      view({ transfers: [{ kind: 'estimate', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 13450 }] }),
      lookup,
      money,
    );
    assert.equal(model.kind, 'estimate');
    if (model.kind !== 'estimate') return;
    assert.equal(model.title, 'いまの精算見込み');
    assert.deepEqual(model.lines, [
      {
        key: 'estimate-0',
        transferId: null,
        fromName: '彼女',
        toName: 'あなた',
        amountText: '¥13,450',
        statusText: null,
        pending: false,
        canCarry: false,
      },
    ]);
    assert.equal(model.emptyText, null);
    assert.equal(model.carryNote, null);
  });

  it('送金が無いときは、「精算はありません」', () => {
    const model = buildSettlement(view(), lookup, money);
    assert.equal(model.kind === 'estimate' && model.emptyText, 'いまのところ精算はありません');
  });

  it('繰越を含むときは、繰越の額を添える（送金先に足す側の合計）', () => {
    const model = buildSettlement(
      view({ members: [monthMember('m1', { carriedInMinor: 5000 }), monthMember('m2', { carriedInMinor: -5000 })] }),
      lookup,
      money,
    );
    assert.equal(model.kind === 'estimate' && model.carryNote, '先月からの繰越 ¥5,000 を含みます');
  });

  it('繰越の受け取り側が複数人でも、足す側の合計（繰り越した総額）を出す', () => {
    const model = buildSettlement(
      view({
        members: [
          monthMember('m1', { carriedInMinor: 3000 }),
          monthMember('m2', { carriedInMinor: 2000 }),
          monthMember('m3', { carriedInMinor: -5000 }),
        ],
      }),
      lookup,
      money,
    );
    assert.equal(model.kind === 'estimate' && model.carryNote, '先月からの繰越 ¥5,000 を含みます');
  });

  it('締められないときは、理由を添える', () => {
    const blocked = (close: MonthView['close']) => {
      const model = buildSettlement(view({ close }), lookup, money);
      return model.kind === 'estimate' ? model.blockedText : undefined;
    };
    assert.equal(blocked({ closable: true }), null);
    assert.equal(
      blocked({ closable: false, reason: 'previous_month_not_closed', month: '2026-10' }),
      '先に10月を締めてください',
    );
    assert.equal(
      blocked({ closable: false, reason: 'previous_month_unsettled', month: '2026-10' }),
      '先に10月分の精算を済ませてください',
    );
  });
});

describe('精算（締める前）の「この月を締める」', () => {
  const lookup = memberLookup(group);

  it('サーバーが返す close.closable を、そのまま押せるかにする（アプリで判断しない）', () => {
    const closable = (close: MonthView['close']) => {
      const model = buildSettlement(view({ close }), lookup, money);
      return model.kind === 'estimate' ? model.closable : undefined;
    };
    assert.equal(closable({ closable: true }), true);
    assert.equal(closable({ closable: false, reason: 'previous_month_not_closed', month: '2026-10' }), false);
    assert.equal(closable({ closable: false, reason: 'unknown', month: null }), false);
  });

  it('押せないときは、必ず理由が添わる（理由の無い、押せないボタンを出さない）。ただし、知らない理由も文言にする', () => {
    for (const reason of ['forbidden', 'month_skipped', 'month_not_started', 'previous_month_not_closed', 'previous_month_unsettled', 'unknown'] as const) {
      const model = buildSettlement(view({ close: { closable: false, reason, month: null } }), lookup, money);
      assert.ok(model.kind === 'estimate' && model.blockedText !== null && model.blockedText.length > 0, reason);
    }
  });
});

describe('closeBlockedText', () => {
  it('理由ごとの文言。月が無いときも、文が崩れない', () => {
    assert.equal(closeBlockedText({ closable: true }), null);
    assert.equal(closeBlockedText({ closable: false, reason: 'month_closed', month: null }), null);
    assert.equal(
      closeBlockedText({ closable: false, reason: 'previous_month_not_closed', month: null }),
      '先に前の月を締めてください',
    );
    for (const reason of ['month_not_started', 'month_skipped', 'forbidden', 'unknown'] as const) {
      const text = closeBlockedText({ closable: false, reason, month: null });
      assert.ok(text && text.length > 0, reason);
      assert.ok(!/[\u2014\u2015\u2E3A\u2E3B]/.test(text), reason);
    }
  });
});

describe('精算（締めた月）', () => {
  const lookup = memberLookup(group);
  const closed = (
    transfers: { id: string; status: 'pending' | 'settled' | 'carried'; canCarry?: boolean }[],
    processed: boolean,
  ): MonthView =>
    view({
      month: '2026-10',
      closed: true,
      closing: { id: 'cl1', closedAt: 0, closedByMemberId: 'm1', processed },
      transfers: transfers.map((transfer) => ({
        kind: 'closed',
        id: transfer.id,
        fromMemberId: 'm2',
        toMemberId: 'm1',
        amountMinor: 3000,
        status: transfer.status,
        canCarry: transfer.canCarry ?? transfer.status === 'pending',
      })),
      close: { closable: false, reason: 'month_closed', month: null },
    });

  it('送金ごとに状態を出し、未処理の件数を見出しに添える', () => {
    const model = buildSettlement(
      closed(
        [
          { id: 't1', status: 'pending' },
          { id: 't2', status: 'settled' },
          { id: 't3', status: 'pending' },
          { id: 't4', status: 'carried' },
        ],
        false,
      ),
      lookup,
      money,
    );
    assert.equal(model.kind, 'closed');
    if (model.kind !== 'closed') return;
    assert.equal(model.title, '10月の精算');
    assert.equal(model.pendingText, '未処理 2件');
    assert.equal(model.doneText, null);
    assert.deepEqual(model.lines.map((line) => [line.key, line.statusText, line.pending]), [
      ['t1', '未処理', true],
      ['t2', '精算済み', false],
      ['t3', '未処理', true],
      ['t4', '繰越済み', false],
    ]);
  });

  it('すべて処理済みなら、「処理済みです」と出す（未処理の件数は出さない）', () => {
    const model = buildSettlement(closed([{ id: 't1', status: 'settled' }], true), lookup, money);
    assert.equal(model.kind === 'closed' && model.pendingText, null);
    assert.equal(model.kind === 'closed' && model.doneText, '10月分は処理済みです');
  });

  it('送金が0件の月も、処理済みなら「処理済みです」', () => {
    const model = buildSettlement(closed([], true), lookup, money);
    assert.equal(model.kind === 'closed' && model.doneText, '10月分は処理済みです');
    assert.equal(model.kind === 'closed' && model.lines.length, 0);
  });
});

describe('精算（締めた月）の操作に使う項目', () => {
  const lookup = memberLookup(group);
  const closedMonth = (month: string, transfers: { id: string; status: 'pending' | 'settled' | 'carried'; canCarry: boolean }[]): MonthView =>
    view({
      month,
      closed: true,
      closing: { id: 'cl1', closedAt: 0, closedByMemberId: 'm1', processed: false },
      transfers: transfers.map((transfer) => ({
        kind: 'closed',
        id: transfer.id,
        fromMemberId: 'm2',
        toMemberId: 'm1',
        amountMinor: 13450,
        status: transfer.status,
        canCarry: transfer.canCarry,
      })),
      close: { closable: false, reason: 'month_closed', month: null },
    });

  it('送金のID・未処理か・繰り越せるかを、送金ごとに持つ。繰り越せるのは、未処理で、サーバーが許したものだけ', () => {
    const model = buildSettlement(
      closedMonth('2026-10', [
        { id: 't1', status: 'pending', canCarry: true },
        { id: 't2', status: 'pending', canCarry: false },
        // 処理済みは、サーバーの値が何でも、繰り越せない（操作のボタンを出さない）
        { id: 't3', status: 'settled', canCarry: true },
        { id: 't4', status: 'carried', canCarry: true },
      ]),
      lookup,
      money,
    );
    assert.equal(model.kind, 'closed');
    if (model.kind !== 'closed') return;
    assert.deepEqual(
      model.lines.map((line) => [line.transferId, line.pending, line.canCarry]),
      [
        ['t1', true, true],
        ['t2', true, false],
        ['t3', false, false],
        ['t4', false, false],
      ],
    );
  });

  it('繰越先の月の名前（年をまたぐときも）', () => {
    const label = (month: string) => {
      const model = buildSettlement(closedMonth(month, [{ id: 't1', status: 'pending', canCarry: true }]), lookup, money);
      return model.kind === 'closed' ? model.carryMonthLabel : undefined;
    };
    assert.equal(label('2026-10'), '11月');
    assert.equal(label('2026-12'), '1月');
  });
});

describe('精算完了・繰越の確認の文言', () => {
  const line = {
    key: 't1',
    transferId: 't1',
    fromName: '彼女',
    toName: 'あなた',
    amountText: '¥13,450',
    statusText: '未処理',
    pending: true,
    canCarry: true,
  };

  it('精算完了: 向きと金額を示し、元に戻せないことを添える', () => {
    assert.deepEqual(settleConfirmText(line), {
      title: '彼女 → あなた ¥13,450 を精算済みにします。',
      message: '元に戻せません。',
      confirmLabel: '精算済みにする',
    });
  });

  it('繰越: 繰越先の月に合算することと、どの送金かを示し、元に戻せないことを添える', () => {
    assert.deepEqual(carryConfirmText(line, '12月'), {
      title: '¥13,450 を12月の精算に合算します。',
      message: '彼女 → あなた の送金です。元に戻せません。',
      confirmLabel: '繰り越す',
    });
  });

  it('繰り越せない理由は、脱退するメンバーと削除されたユーザーの両方に当てはまる言い方にする', () => {
    assert.match(CARRY_BLOCKED_TEXT, /脱退するメンバー/);
    assert.match(CARRY_BLOCKED_TEXT, /削除されたユーザー/);
  });

  it('長いダッシュを含まない', () => {
    const texts = [settleConfirmText(line), carryConfirmText(line, '12月')].flatMap((text) => [text.title, text.message, text.confirmLabel]);
    for (const text of [...texts, CARRY_BLOCKED_TEXT]) assert.ok(!/[\u2014\u2015\u2E3A\u2E3B]/.test(text), text);
  });
});

describe('支出の一覧', () => {
  const lookup = memberLookup(group);
  const expense = (patch: Partial<Expense> = {}): Expense => ({
    id: 'e1',
    expenseDate: '2026-11-19',
    targetMonth: '2026-11',
    description: 'スーパー',
    amountMinor: 4280,
    categoryId: 'c1',
    payerMemberId: 'm1',
    recurringExpenseId: null,
    splitMethod: 'category',
    ...patch,
  });

  it('内容があれば見出しにし、費目・日付・支払った人を添える', () => {
    const [row] = buildExpenseRows([expense()], categories, lookup, money);
    assert.deepEqual(row, {
      id: 'e1',
      title: 'スーパー',
      subtitle: '食費・11/19(木)・あなた',
      icon: 'cart',
      color: 'green',
      amountText: '¥4,280',
      badges: [],
    });
  });

  it('内容が無ければ（空白だけも）費目名を見出しにする（費目名を二重に出さない）', () => {
    for (const description of [null, '', '  ']) {
      const [row] = buildExpenseRows([expense({ description })], categories, lookup, money);
      assert.equal(row?.title, '食費');
      assert.equal(row?.subtitle, '11/19(木)・あなた');
    }
  });

  it('負担を変えた支出と固定費の支出に、印を付ける', () => {
    const rows = buildExpenseRows(
      [
        expense({ id: 'a', splitMethod: 'equal' }),
        expense({ id: 'b', recurringExpenseId: 'r1' }),
        expense({ id: 'c', splitMethod: 'single', recurringExpenseId: 'r1' }),
        expense({ id: 'd' }),
      ],
      categories,
      lookup,
      money,
    );
    assert.deepEqual(rows.map((row) => row.badges), [['負担を変更'], ['固定費'], ['負担を変更', '固定費'], []]);
  });

  it('アーカイブした費目の名前も出す。一覧に無い費目と、脱退したメンバーは既定・名前のまま', () => {
    const rows = buildExpenseRows(
      [expense({ categoryId: 'c2', description: null }), expense({ categoryId: 'zzz', description: null, payerMemberId: 'm3' })],
      categories,
      lookup,
      money,
    );
    assert.equal(rows[0]?.title, '昔の費目');
    assert.equal(rows[1]?.title, '不明な費目');
    assert.equal(rows[1]?.icon, 'more');
    assert.equal(rows[1]?.subtitle, '11/19(木)・脱退した人');
  });

  it('順序は、サーバーの並び（日付の新しい順）のまま', () => {
    const rows = buildExpenseRows([expense({ id: 'x' }), expense({ id: 'y' }), expense({ id: 'z' })], categories, lookup, money);
    assert.deepEqual(rows.map((row) => row.id), ['x', 'y', 'z']);
  });
});
