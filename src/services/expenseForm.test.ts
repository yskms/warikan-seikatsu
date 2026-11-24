// 支出の登録・編集シートの入力の状態・検査・リクエストの組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { Category, ExpenseDetail, MonthListItem } from '../domain/month.ts';
import {
  buildCreateRequest,
  buildFormContext,
  buildUpdatePlan,
  categoryOptions,
  checkDraft,
  defaultTargetMonth,
  equalPercents,
  initialDraft,
  isMemberSelectable,
  monthChoices,
  monthNote,
  originalSplit,
  parsePercent,
  payerOptions,
  percentText,
  splitLocked,
  splitMembers,
  syncForMonth,
  splitMemberIdsOf,
  targetMonthOf,
  toggleCustomSplit,
  type ExpenseDraft,
  type ExpenseFormContext,
  type SplitDraft,
} from './expenseForm.ts';

function member(id: string, extra: Partial<GroupMember> = {}): GroupMember {
  return {
    id,
    displayName: id === 'm1' ? 'あなた' : id === 'm2' ? '彼女' : id,
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-01',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    isMe: id === 'm1',
    ...extra,
  };
}

const categories: Category[] = [
  { id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false },
  { id: 'c2', name: '食費', icon: 'cart', color: 'green', sortOrder: 2, archived: false },
  { id: 'c3', name: '旧', icon: 'more', color: 'gray', sortOrder: 3, archived: true },
];

const months: MonthListItem[] = [
  { month: '2026-09', status: 'skipped' },
  { month: '2026-10', status: 'settled' },
  { month: '2026-11', status: 'open' },
];

function group(extra: Partial<GroupDetail> = {}): GroupDetail {
  return {
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
    members: [member('m1'), member('m2')],
    ...extra,
  };
}

// 2026-11-19 12:00（東京）
const NOW = new Date(Date.UTC(2026, 10, 19, 3, 0, 0));

function context(extra: Partial<ExpenseFormContext> = {}, expense: ExpenseDetail | null = null): ExpenseFormContext {
  return {
    ...buildFormContext({ group: group(), months: { currentMonth: '2026-11', months }, categories, expense }, NOW),
    ...extra,
  };
}

function detail(extra: Partial<ExpenseDetail> = {}): ExpenseDetail {
  return {
    id: 'e1',
    expenseDate: '2026-11-10',
    targetMonth: '2026-11',
    description: 'スーパー',
    amountMinor: 4280,
    categoryId: 'c2',
    payerMemberId: 'm1',
    recurringExpenseId: null,
    splitMethod: 'category',
    allocations: [],
    closed: false,
    ...extra,
  };
}

function draft(ctx: ExpenseFormContext, extra: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return { ...initialDraft(ctx, null), amount: '1200', ...extra };
}

const split = (extra: Partial<SplitDraft>): SplitDraft => ({
  method: 'equal',
  percents: { m1: '50', m2: '50' },
  equalIds: ['m1', 'm2'],
  amounts: {},
  singleId: null,
  ...extra,
});

describe('buildFormContext', () => {
  it('登録できる月は、月の一覧の open。今日は、グループのタイムゾーンで', () => {
    const ctx = context();
    assert.deepEqual(ctx.registerableMonths, ['2026-11']);
    assert.equal(ctx.today, '2026-11-19');
    assert.equal(ctx.currentMonth, '2026-11');
    assert.equal(ctx.myMemberId, 'm1');
    assert.equal(ctx.readOnly, false);
    const utc = buildFormContext(
      { group: group({ timezone: 'America/Los_Angeles' }), months: { currentMonth: '2026-11', months }, categories, expense: null },
      new Date(Date.UTC(2026, 10, 19, 3, 0, 0)),
    );
    assert.equal(utc.today, '2026-11-18');
  });

  it('締めた月の支出は、読み取り専用', () => {
    assert.equal(context({}, detail({ closed: true })).readOnly, true);
  });
});

describe('登録先の月', () => {
  const two: MonthListItem[] = [
    { month: '2026-10', status: 'open' },
    { month: '2026-11', status: 'open' },
  ];

  it('日付の月が登録できる月ならその月', () => {
    const ctx = context({ months: two, registerableMonths: ['2026-10', '2026-11'] });
    assert.equal(defaultTargetMonth('2026-10-31', ctx), '2026-10');
    assert.equal(defaultTargetMonth('2026-11-01', ctx), '2026-11');
  });

  it('登録できなければ、登録できる月のうち今月に最も近い月（同じ距離なら新しいほう）', () => {
    const ctx = context();
    assert.equal(defaultTargetMonth('2026-10-20', ctx), '2026-11');
    assert.equal(defaultTargetMonth('2027-03-01', ctx), '2026-11');
    // 今月を早めに締めた後は、翌月だけ
    const after = context({ currentMonth: '2026-11', registerableMonths: ['2026-12'] });
    assert.equal(defaultTargetMonth('2026-11-25', after), '2026-12');
    const tie = context({ currentMonth: '2026-11', registerableMonths: ['2026-10', '2026-12'] });
    assert.equal(defaultTargetMonth('2026-01-01', tie), '2026-12');
    assert.equal(defaultTargetMonth('2026-01-01', context({ registerableMonths: [] })), null);
  });

  it('選んだ月が優先。選んでいなければ日付から決まる', () => {
    const ctx = context({ months: two, registerableMonths: ['2026-10', '2026-11'] });
    assert.equal(targetMonthOf(draft(ctx, { date: '2026-10-05' }), ctx), '2026-10');
    assert.equal(targetMonthOf(draft(ctx, { date: '2026-10-05', monthChoice: '2026-11' }), ctx), '2026-11');
  });

  it('日付の月に登録できないときの添え書き（締めた月と、そうでない月）', () => {
    const ctx = context();
    assert.equal(monthNote(draft(ctx, { date: '2026-10-20' }), ctx), '10月は締めたため、11月分として登録します。');
    assert.equal(monthNote(draft(ctx, { date: '2027-01-02' }), ctx), '1月分は登録できないため、11月分として登録します。');
    assert.equal(monthNote(draft(ctx, { date: '2026-11-02' }), ctx), null);
    // 月を自分で選んだら、添えない
    assert.equal(monthNote(draft(ctx, { date: '2026-10-20', monthChoice: '2026-11' }), ctx), null);
  });

  it('選択肢は、登録できる月。編集で開いた支出の月は、登録できなくても含める', () => {
    assert.deepEqual(monthChoices(context()), ['2026-11']);
    assert.deepEqual(monthChoices(context({}, detail({ targetMonth: '2026-09' }))), ['2026-09', '2026-11']);
  });
});

describe('メンバー・費目の選択肢', () => {
  it('選べるメンバー: 参加した月から、脱退月まで。脱退済み・削除済み・知らない状態は選べない', () => {
    assert.equal(isMemberSelectable(member('a'), '2026-11'), true);
    assert.equal(isMemberSelectable(member('a', { historyFromMonth: '2026-12' }), '2026-11'), false);
    assert.equal(isMemberSelectable(member('a', { status: 'leaving', expenseEndMonth: '2026-11' }), '2026-11'), true);
    assert.equal(isMemberSelectable(member('a', { status: 'leaving', expenseEndMonth: '2026-10' }), '2026-11'), false);
    // 脱退を選んだだけ（確定前）は、脱退月まで
    assert.equal(isMemberSelectable(member('a', { leaveRequestedMonth: '2026-11' }), '2026-11'), true);
    assert.equal(isMemberSelectable(member('a', { leaveRequestedMonth: '2026-10' }), '2026-11'), false);
    assert.equal(isMemberSelectable(member('a', { status: 'left' }), '2026-11'), false);
    assert.equal(isMemberSelectable(member('a', { status: 'deleted' }), '2026-11'), false);
    assert.equal(isMemberSelectable(member('a', { status: 'unknown' }), '2026-11'), false);
  });

  it('編集で開いた支出の、支払者・負担のメンバーは、選べなくても、いまの値として並ぶ', () => {
    const left = member('m3', { status: 'left' });
    const ctx = context(
      { members: [member('m1'), member('m2'), left] },
      detail({ payerMemberId: 'm3', splitMethod: 'equal', allocations: [{ memberId: 'm3', burdenMinor: 1, shareBasisPoints: null }] }),
    );
    assert.deepEqual(payerOptions(ctx, '2026-11').map((m) => m.id), ['m1', 'm2', 'm3']);
    assert.deepEqual(splitMembers(ctx, '2026-11').map((m) => m.id), ['m1', 'm2', 'm3']);
    // 新規なら、選べないメンバーは並ばない
    const fresh = context({ members: [member('m1'), member('m2'), left] });
    assert.deepEqual(payerOptions(fresh, '2026-11').map((m) => m.id), ['m1', 'm2']);
  });

  it('費目: アーカイブした費目は選べない（編集で開いた支出の費目は、いまの値として含める）', () => {
    assert.deepEqual(categoryOptions(context()).map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(categoryOptions(context({}, detail({ categoryId: 'c3' }))).map((c) => c.id), ['c1', 'c2', 'c3']);
  });
});

describe('initialDraft', () => {
  it('新規: 今日・自分が支払う・前回選んだ費目（無ければ先頭、アーカイブ済みなら先頭）', () => {
    const ctx = context();
    const first = initialDraft(ctx, null);
    assert.deepEqual(first, {
      amount: '',
      categoryId: 'c1',
      payerMemberId: 'm1',
      date: '2026-11-19',
      description: '',
      monthChoice: null,
      split: null,
    });
    assert.equal(initialDraft(ctx, 'c2').categoryId, 'c2');
    assert.equal(initialDraft(ctx, 'c3').categoryId, 'c1');
    assert.equal(initialDraft(ctx, 'zzz').categoryId, 'c1');
  });

  it('編集: 保存されている値を、金額は式なしで入れる。月は、保存された月に固定', () => {
    const ctx = context({ minorUnit: 2 }, detail({ amountMinor: 1250 }));
    const d = initialDraft(ctx, 'c1');
    assert.equal(d.amount, '12.5');
    assert.equal(d.categoryId, 'c2');
    assert.equal(d.date, '2026-11-10');
    assert.equal(d.description, 'スーパー');
    assert.equal(d.monthChoice, '2026-11');
    assert.equal(d.split, null);
  });

  it('編集: 保存された負担の指定を、入力に戻す', () => {
    const ratio = context(
      {},
      detail({
        splitMethod: 'ratio',
        allocations: [
          { memberId: 'm1', burdenMinor: 2996, shareBasisPoints: 7000 },
          { memberId: 'm2', burdenMinor: 1284, shareBasisPoints: 3000 },
        ],
      }),
    );
    const r = initialDraft(ratio, null).split;
    assert.equal(r?.method, 'ratio');
    assert.deepEqual(r?.percents, { m1: '70', m2: '30' });

    const fixed = context(
      {},
      detail({
        splitMethod: 'fixed',
        allocations: [
          { memberId: 'm1', burdenMinor: 4000, shareBasisPoints: null },
          { memberId: 'm2', burdenMinor: 280, shareBasisPoints: null },
        ],
      }),
    );
    assert.deepEqual(initialDraft(fixed, null).split?.amounts, { m1: '4000', m2: '280' });

    const single = context({}, detail({ splitMethod: 'single', allocations: [{ memberId: 'm2', burdenMinor: 4280, shareBasisPoints: null }] }));
    assert.equal(initialDraft(single, null).split?.singleId, 'm2');

    const equal = context(
      {},
      detail({
        splitMethod: 'equal',
        allocations: [{ memberId: 'm1', burdenMinor: 2140, shareBasisPoints: null }],
      }),
    );
    assert.deepEqual(initialDraft(equal, null).split?.equalIds, ['m1']);
  });
});

describe('originalSplit', () => {
  it('知らない負担の方法・読み取れない形は unsupported（アプリは変えない）', () => {
    assert.equal(originalSplit(detail({ splitMethod: 'weighted' })).kind, 'unsupported');
    assert.equal(originalSplit(detail({ splitMethod: 'equal', allocations: [] })).kind, 'unsupported');
    assert.equal(originalSplit(detail({ splitMethod: 'single', allocations: [] })).kind, 'unsupported');
    assert.equal(
      originalSplit(detail({ splitMethod: 'ratio', allocations: [{ memberId: 'm1', burdenMinor: 1, shareBasisPoints: null }] })).kind,
      'unsupported',
    );
    assert.equal(
      originalSplit(detail({ splitMethod: 'ratio', allocations: [{ memberId: 'm1', burdenMinor: 1, shareBasisPoints: 9000 }] })).kind,
      'unsupported',
    );
    assert.equal(originalSplit(detail({ splitMethod: 'category' })).kind, 'known');
    assert.equal(splitLocked(context({}, detail({ splitMethod: 'weighted' }))), true);
    assert.equal(splitLocked(context()), false);
  });
});

describe('割合の入力', () => {
  it('percentText / parsePercent', () => {
    assert.equal(percentText(7000), '70');
    assert.equal(percentText(3334), '33.34');
    assert.equal(percentText(3330), '33.3');
    assert.equal(percentText(5), '0.05');
    assert.equal(percentText(10000), '100');
    assert.equal(parsePercent('70'), 7000);
    assert.equal(parsePercent('33.34'), 3334);
    assert.equal(parsePercent('33.3'), 3330);
    assert.equal(parsePercent('0.05'), 5);
    assert.equal(parsePercent(' 100 '), 10000);
    assert.equal(parsePercent(''), 0);
    for (const bad of ['101', '100.01', '1.234', '-1', 'a', '1e2', '１０', '.5', '5.']) assert.equal(parsePercent(bad), null, bad);
  });

  it('percentText と parsePercent は、往復で同じ値', () => {
    for (const value of [0, 1, 10, 3333, 3334, 5000, 9999, 10000]) assert.equal(parsePercent(percentText(value)), value);
  });

  it('均等の初期値: 合計が100%になる（端数は先頭から）', () => {
    assert.deepEqual(equalPercents(['a', 'b']), { a: '50', b: '50' });
    assert.deepEqual(equalPercents(['a', 'b', 'c']), { a: '33.34', b: '33.33', c: '33.33' });
    assert.deepEqual(equalPercents([]), {});
    for (const count of [1, 2, 3, 4, 5, 7]) {
      const ids = Array.from({ length: count }, (_, i) => `m${i}`);
      const total = Object.values(equalPercents(ids)).reduce((sum, text) => sum + (parsePercent(text) ?? 0), 0);
      assert.equal(total, 10000, String(count));
    }
  });
});

describe('負担の入力の切り替え', () => {
  it('オンにすると、全員で均等から始まる。もう一度押すと、費目の割合に戻る', () => {
    const ctx = context();
    const on = toggleCustomSplit(draft(ctx), ctx);
    assert.equal(on.split?.method, 'equal');
    assert.deepEqual(on.split?.equalIds, ['m1', 'm2']);
    assert.deepEqual(on.split?.percents, { m1: '50', m2: '50' });
    assert.equal(toggleCustomSplit(on, ctx).split, null);
  });

  it('登録先の月を変えると、選べないメンバーを外し、入力は残るメンバーで保つ', () => {
    const ctx = context({
      members: [member('m1'), member('m2', { historyFromMonth: '2026-12' })],
      registerableMonths: ['2026-11', '2026-12'],
    });
    const base = draft(ctx, { monthChoice: '2026-12', split: split({ method: 'ratio', percents: { m1: '60', m2: '40' }, equalIds: ['m1', 'm2'], singleId: 'm2' }) });
    const back = syncForMonth({ ...base, monthChoice: '2026-11' }, ctx);
    assert.deepEqual(Object.keys(back.split!.percents), ['m1']);
    assert.equal(back.split!.percents.m1, '60');
    assert.deepEqual(back.split!.equalIds, ['m1']);
    assert.equal(back.split!.singleId, null);
    assert.equal(syncForMonth(draft(ctx), ctx).split, null);
  });
});

describe('checkDraft', () => {
  it('金額が空のあいだは、案内を出さず、保存できない。入力すると、保存の文言に金額が出る', () => {
    const ctx = context();
    const empty = checkDraft(initialDraft(ctx, null), ctx);
    assert.equal(empty.canSave, false);
    assert.equal(empty.blocker, null);
    assert.equal(empty.saveLabel, '保存');
    const ok = checkDraft(draft(ctx, { amount: '1200+800' }), ctx);
    assert.equal(ok.canSave, true);
    assert.equal(ok.saveLabel, '保存 ¥2,000');
  });

  it('金額の理由: 0以下・上限超え・計算できない', () => {
    const ctx = context();
    assert.equal(checkDraft(draft(ctx, { amount: '0' }), ctx).blocker, '金額は、1以上にしてください。');
    assert.equal(checkDraft(draft(ctx, { amount: '100-300' }), ctx).blocker, '金額は、1以上にしてください。');
    assert.equal(checkDraft(draft(ctx, { amount: '1000000000001' }), ctx).blocker, '金額は、¥1,000,000,000,000以下にしてください。');
    assert.equal(checkDraft(draft(ctx, { amount: '5/0' }), ctx).blocker, '金額を計算できません。式を直してください。');
    assert.equal(checkDraft(draft(ctx, { amount: '0' }), ctx).canSave, false);
  });

  it('費目・支払者・日付・登録できる月・内容の長さ', () => {
    const ctx = context();
    assert.equal(checkDraft(draft(ctx, { categoryId: null }), ctx).blocker, 'カテゴリを選んでください。');
    assert.equal(checkDraft(draft(ctx, { payerMemberId: null }), ctx).blocker, '支払った人を選んでください。');
    assert.equal(checkDraft(draft(ctx, { date: '2026-02-30' }), ctx).blocker, '日付を選んでください。');
    assert.equal(checkDraft(draft(ctx, {}), context({ registerableMonths: [] })).blocker, '登録できる月がありません。');
    assert.equal(checkDraft(draft(ctx, { description: 'あ'.repeat(100) }), ctx).canSave, true);
    assert.equal(checkDraft(draft(ctx, { description: 'あ'.repeat(101) }), ctx).blocker, '内容は、100文字までにしてください。');
    // 前後の空白は数えない。絵文字は1文字
    assert.equal(checkDraft(draft(ctx, { description: `  ${'😀'.repeat(100)}  ` }), ctx).canSave, true);
  });

  it('締めた月の支出（読み取り専用）は、保存できない', () => {
    const ctx = context({}, detail({ closed: true }));
    assert.equal(checkDraft(initialDraft(ctx, null), ctx).canSave, false);
  });

  it('小数のある通貨でも、最小単位で数える', () => {
    const ctx = context({ currencyCode: 'USD', minorUnit: 2 });
    const check = checkDraft(draft(ctx, { amount: '12.5' }), ctx);
    assert.equal(check.saveLabel, '保存 $12.50');
  });

  describe('負担を変える', () => {
    const ctx = context();

    it('割合: 合計が100%でないとき・形が違うとき', () => {
      const bad = checkDraft(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '70', m2: '20' } }) }), ctx);
      assert.equal(bad.canSave, false);
      assert.equal(bad.blocker, '合計が100%になるように入力してください（いま 90%）。');
      assert.equal(
        checkDraft(draft(ctx, { split: split({ method: 'ratio', percents: { m1: 'abc', m2: '50' } }) }), ctx).blocker,
        '割合は、0から100の数で入力してください（小数は2桁まで）。',
      );
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '100', m2: '0' } }) }), ctx).canSave, true);
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '33.33', m2: '66.67' } }) }), ctx).canSave, true);
    });

    it('均等: 1人以上', () => {
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'equal', equalIds: [] }) }), ctx).blocker, '負担する人を、1人以上選んでください。');
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'equal', equalIds: ['m2'] }) }), ctx).canSave, true);
    });

    it('1人が全額: 選んでいること', () => {
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'single', singleId: null }) }), ctx).blocker, '全額を負担する人を選んでください。');
      assert.equal(checkDraft(draft(ctx, { split: split({ method: 'single', singleId: 'm2' }) }), ctx).canSave, true);
    });

    it('金額指定: 合計が金額と一致するとき。差を出す', () => {
      const fixed = (amounts: Record<string, string>, amount = '1200') =>
        checkDraft(draft(ctx, { amount, split: split({ method: 'fixed', amounts }) }), ctx);
      assert.equal(fixed({ m1: '1000', m2: '200' }).canSave, true);
      // 式も使える。空は0
      assert.equal(fixed({ m1: '1000+200' }).canSave, true);
      assert.equal(fixed({ m1: '1000', m2: '100' }).blocker, '合計が¥1,200になるように入力してください（差 -¥100）。');
      assert.equal(fixed({ m1: '1000', m2: '300' }).blocker, '合計が¥1,200になるように入力してください（差 +¥100）。');
      assert.equal(fixed({ m1: '5/0' }).blocker, '金額を読み取れません。入力し直してください。');
      assert.equal(fixed({ m1: '100-300' }).blocker, '金額を読み取れません。入力し直してください。');
      assert.equal(fixed({ m1: '1200' }, '').blocker, '先に、上の金額を入力してください。');
    });
  });
});

describe('buildCreateRequest', () => {
  const ID = '3f2b9c1e-0a4d-4f6b-9d2e-1c7a8b5e4f30';

  it('費目の割合で分ける登録。内容が空なら送らない。金額は式の結果。通貨を添える', () => {
    const ctx = context();
    const request = buildCreateRequest(draft(ctx, { amount: '1200+800', description: '  ' }), ctx, ID);
    assert.deepEqual(request, {
      id: ID,
      expenseDate: '2026-11-19',
      targetMonth: '2026-11',
      amountMinor: 2000,
      categoryId: 'c1',
      payerMemberId: 'm1',
      split: { method: 'category' },
      currencyCode: 'JPY',
    });
    assert.equal('description' in request!, false);
    assert.equal(buildCreateRequest(draft(ctx, { description: ' スーパー ' }), ctx, ID)?.description, 'スーパー');
  });

  it('日付の月に登録できないときは、近い月に登録する。選んだ月が優先', () => {
    const ctx = context({ registerableMonths: ['2026-11', '2026-12'] });
    assert.equal(buildCreateRequest(draft(ctx, { date: '2026-10-20' }), ctx, ID)?.targetMonth, '2026-11');
    assert.equal(buildCreateRequest(draft(ctx, { date: '2026-11-20', monthChoice: '2026-12' }), ctx, ID)?.targetMonth, '2026-12');
  });

  it('保存できない入力は null', () => {
    const ctx = context();
    assert.equal(buildCreateRequest(initialDraft(ctx, null), ctx, ID), null);
    assert.equal(buildCreateRequest(draft(ctx, { amount: '0' }), ctx, ID), null);
    assert.equal(buildCreateRequest(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '10', m2: '10' } }) }), ctx, ID), null);
  });

  it('負担を変える: 均等・割合・金額指定・1人が全額', () => {
    const ctx = context();
    assert.deepEqual(buildCreateRequest(draft(ctx, { split: split({ method: 'equal', equalIds: ['m2', 'm1'] }) }), ctx, ID)?.split, {
      method: 'equal',
      memberIds: ['m1', 'm2'],
    });
    assert.deepEqual(buildCreateRequest(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '70', m2: '30' } }) }), ctx, ID)?.split, {
      method: 'ratio',
      shares: [
        { memberId: 'm1', basisPoints: 7000 },
        { memberId: 'm2', basisPoints: 3000 },
      ],
    });
    // 0%・空のメンバーは送らない（負担額が0の行を作らない。0円の行は、あとの脱退の確定で「負担に関わっている」とみなされうる）
    assert.deepEqual(buildCreateRequest(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '100' } }) }), ctx, ID)?.split, {
      method: 'ratio',
      shares: [{ memberId: 'm1', basisPoints: 10000 }],
    });
    assert.deepEqual(
      buildCreateRequest(draft(ctx, { split: split({ method: 'fixed', amounts: { m1: '1000', m2: '' }, }) , amount: '1000' }), ctx, ID)?.split,
      { method: 'fixed', amounts: [{ memberId: 'm1', amountMinor: 1000 }] },
    );
    assert.deepEqual(buildCreateRequest(draft(ctx, { split: split({ method: 'single', singleId: 'm2' }) }), ctx, ID)?.split, {
      method: 'single',
      memberId: 'm2',
    });
  });

  it('負担の対象は、その月に選べるメンバーだけを送る', () => {
    const ctx = context({ members: [member('m1'), member('m2', { status: 'left' })] });
    const d = draft(ctx, { split: split({ method: 'ratio', percents: { m1: '100', m2: '0' } }) });
    assert.deepEqual(buildCreateRequest(d, ctx, ID)?.split, { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 10000 }] });
  });
});

describe('buildUpdatePlan', () => {
  const equalDetail = detail({
    splitMethod: 'equal',
    allocations: [
      { memberId: 'm1', burdenMinor: 2140, shareBasisPoints: null },
      { memberId: 'm2', burdenMinor: 2140, shareBasisPoints: null },
    ],
  });

  function plan(ctx: ExpenseFormContext, change: Partial<ExpenseDraft>) {
    return buildUpdatePlan({ ...initialDraft(ctx, null), ...change }, ctx);
  }

  it('何も変えていなければ unchanged', () => {
    assert.deepEqual(plan(context({}, detail()), {}), { kind: 'unchanged' });
    assert.deepEqual(plan(context({}, equalDetail), {}), { kind: 'unchanged' });
  });

  it('変えた項目だけを送る（内容・日付だけの編集は、負担に触れない）', () => {
    const ctx = context({}, equalDetail);
    assert.deepEqual(plan(ctx, { description: '  コンビニ ' }), { kind: 'request', request: { description: 'コンビニ' } });
    assert.deepEqual(plan(ctx, { date: '2026-11-11' }), { kind: 'request', request: { expenseDate: '2026-11-11' } });
    assert.deepEqual(plan(ctx, { categoryId: 'c1', payerMemberId: 'm2' }), {
      kind: 'request',
      request: { categoryId: 'c1', payerMemberId: 'm2' },
    });
  });

  it('内容を空にすると null で消す。もともと無い内容を空のままにしても、送らない', () => {
    assert.deepEqual(plan(context({}, detail()), { description: '' }), { kind: 'request', request: { description: null } });
    assert.deepEqual(plan(context({}, detail({ description: null })), { description: '' }), { kind: 'unchanged' });
  });

  it('金額を変えると currencyCode を添える。費目の割合の支出は、split を送らない', () => {
    const ctx = context({}, detail());
    assert.deepEqual(plan(ctx, { amount: '5000' }), { kind: 'request', request: { amountMinor: 5000, currencyCode: 'JPY' } });
  });

  it('費目の割合でない支出の金額を変えるときは、split も送る（サーバーが求める）', () => {
    const ctx = context({}, equalDetail);
    const result = plan(ctx, { amount: '5000' });
    assert.deepEqual(result, {
      kind: 'request',
      request: { amountMinor: 5000, currencyCode: 'JPY', split: { method: 'equal', memberIds: ['m1', 'm2'] } },
    });
  });

  it('負担の指定を変えたら、split を送る。費目の割合に戻すときは category', () => {
    const ctx = context({}, equalDetail);
    const changed = plan(ctx, { split: split({ method: 'single', singleId: 'm2' }) });
    assert.deepEqual(changed, { kind: 'request', request: { split: { method: 'single', memberId: 'm2' } } });
    assert.deepEqual(plan(ctx, { split: null }), { kind: 'request', request: { split: { method: 'category' } } });
    // 費目の割合の支出に、負担の指定を足す
    assert.deepEqual(plan(context({}, detail()), { split: split({ method: 'equal', equalIds: ['m1'] }) }), {
      kind: 'request',
      request: { split: { method: 'equal', memberIds: ['m1'] } },
    });
  });

  it('負担の指定を同じ内容に入れ直しただけなら、変更なし（並びが違っても）', () => {
    const ctx = context({}, equalDetail);
    assert.deepEqual(plan(ctx, { split: split({ method: 'equal', equalIds: ['m2', 'm1'] }) }), { kind: 'unchanged' });
  });

  it('登録する月を変える', () => {
    const ctx = context({ registerableMonths: ['2026-11', '2026-12'] }, detail());
    assert.deepEqual(plan(ctx, { monthChoice: '2026-12' }), { kind: 'request', request: { targetMonth: '2026-12' } });
  });

  it('アプリが変えられない負担の方法の支出: split は送らない。金額は変えられない', () => {
    const ctx = context({}, detail({ splitMethod: 'weighted' }));
    assert.deepEqual(plan(ctx, { description: 'x' }), { kind: 'request', request: { description: 'x' } });
    assert.deepEqual(plan(ctx, { amount: '5000' }), { kind: 'invalid' });
    assert.equal(checkDraft({ ...initialDraft(ctx, null), amount: '5000' }, ctx).blocker, 'この支出の負担の方法は、このアプリでは変えられないため、金額は変えられません。');
    assert.deepEqual(plan(ctx, {}), { kind: 'unchanged' });
  });

  it('検査に通らない入力・新規・締めた月は invalid', () => {
    assert.deepEqual(plan(context({}, detail()), { amount: '0' }), { kind: 'invalid' });
    assert.deepEqual(plan(context({}, detail({ closed: true })), { description: 'x' }), { kind: 'invalid' });
    const fresh = context();
    assert.deepEqual(buildUpdatePlan(draft(fresh), fresh), { kind: 'invalid' });
  });
});


describe('途中参加のメンバーがいる月の編集（負担の行を増やさない）', () => {
  // m3 は 2026-11 に参加した。元の支出は、参加前に m1・m2 だけで分けたもの
  const members3 = [member('m1'), member('m2'), member('m3', { historyFromMonth: '2026-11' })];
  const ratioDetail = detail({
    splitMethod: 'ratio',
    allocations: [
      { memberId: 'm1', burdenMinor: 2140, shareBasisPoints: 5000 },
      { memberId: 'm2', burdenMinor: 2140, shareBasisPoints: 5000 },
    ],
  });
  const fixedDetail = detail({
    splitMethod: 'fixed',
    allocations: [
      { memberId: 'm1', burdenMinor: 4000, shareBasisPoints: null },
      { memberId: 'm2', burdenMinor: 280, shareBasisPoints: null },
    ],
  });
  const plan = (ctx: ExpenseFormContext, change: Partial<ExpenseDraft>) =>
    buildUpdatePlan({ ...initialDraft(ctx, null), ...change }, ctx);

  it('割合の支出の、内容だけの編集は、split を送らない（m3 の0%の行を足さない）', () => {
    const ctx = context({ members: members3 }, ratioDetail);
    assert.deepEqual(plan(ctx, { description: 'コンビニ' }), { kind: 'request', request: { description: 'コンビニ' } });
    assert.deepEqual(plan(ctx, {}), { kind: 'unchanged' });
  });

  it('金額指定の支出の、内容だけの編集も、split を送らない', () => {
    const ctx = context({ members: members3 }, fixedDetail);
    assert.deepEqual(plan(ctx, { description: 'コンビニ' }), { kind: 'request', request: { description: 'コンビニ' } });
  });

  it('金額を変えて split を送るときも、元の負担に無い人は、0のままなら入れない', () => {
    const ratio = context({ members: members3 }, ratioDetail);
    assert.deepEqual(plan(ratio, { amount: '5000' }), {
      kind: 'request',
      request: {
        amountMinor: 5000,
        currencyCode: 'JPY',
        split: {
          method: 'ratio',
          shares: [
            { memberId: 'm1', basisPoints: 5000 },
            { memberId: 'm2', basisPoints: 5000 },
          ],
        },
      },
    });
    const base = initialDraft(context({ members: members3 }, fixedDetail), null);
    const fixed = context({ members: members3 }, fixedDetail);
    // 金額を 4280 → 5280 に変え、m2 の負担を 1280 にする
    const result = buildUpdatePlan(
      { ...base, amount: '5280', split: { ...base.split!, amounts: { ...base.split!.amounts, m2: '1280' } } },
      fixed,
    );
    assert.deepEqual(result, {
      kind: 'request',
      request: {
        amountMinor: 5280,
        currencyCode: 'JPY',
        split: {
          method: 'fixed',
          amounts: [
            { memberId: 'm1', amountMinor: 4000 },
            { memberId: 'm2', amountMinor: 1280 },
          ],
        },
      },
    });
  });

  it('m3 に割合を入れたら、送る。元の負担にいた人を 0% にしても、その行は残す', () => {
    const ctx = context({ members: members3 }, ratioDetail);
    const base = initialDraft(ctx, null);
    const changed = buildUpdatePlan(
      { ...base, split: { ...base.split!, percents: { m1: '40', m2: '40', m3: '20' } } },
      ctx,
    );
    assert.deepEqual(changed, {
      kind: 'request',
      request: {
        split: {
          method: 'ratio',
          shares: [
            { memberId: 'm1', basisPoints: 4000 },
            { memberId: 'm2', basisPoints: 4000 },
            { memberId: 'm3', basisPoints: 2000 },
          ],
        },
      },
    });
    const zero = buildUpdatePlan({ ...base, split: { ...base.split!, percents: { m1: '100', m2: '0', m3: '0' } } }, ctx);
    assert.deepEqual(zero, {
      kind: 'request',
      request: {
        split: {
          method: 'ratio',
          shares: [
            { memberId: 'm1', basisPoints: 10000 },
            { memberId: 'm2', basisPoints: 0 },
          ],
        },
      },
    });
  });

  it('方法を変えたときは、元の方法の行に引きずられない', () => {
    const ctx = context({ members: members3 }, ratioDetail);
    const base = initialDraft(ctx, null);
    const result = buildUpdatePlan(
      { ...base, split: { ...base.split!, method: 'fixed', amounts: { m1: '4280' } } },
      ctx,
    );
    assert.deepEqual(result, {
      kind: 'request',
      request: { split: { method: 'fixed', amounts: [{ memberId: 'm1', amountMinor: 4280 }] } },
    });
  });
});

describe('月・日付を変えたときの支払者', () => {
  const joined = [member('m1'), member('m2', { historyFromMonth: '2026-11' })];
  const two: MonthListItem[] = [
    { month: '2026-10', status: 'open' },
    { month: '2026-11', status: 'open' },
  ];
  const ctx = () => context({ members: joined, months: two, registerableMonths: ['2026-10', '2026-11'] });

  it('新しい月で選べない支払者は、保存できなくなる（外さない）。その月に戻すと、また保存できる', () => {
    const c = ctx();
    const d = draft(c, { payerMemberId: 'm2', date: '2026-11-05' });
    assert.equal(checkDraft(d, c).canSave, true);
    const moved = syncForMonth({ ...d, date: '2026-10-05' }, c);
    assert.equal(moved.payerMemberId, 'm2');
    assert.equal(checkDraft(moved, c).canSave, false);
    assert.equal(checkDraft(moved, c).blocker, '支払った人を選び直してください。');
    assert.equal(buildCreateRequest(moved, c, '3f2b9c1e-0a4d-4f6b-9d2e-1c7a8b5e4f30'), null);
    // 月の選択でも同じ
    assert.equal(checkDraft(syncForMonth({ ...d, monthChoice: '2026-10' }, c), c).canSave, false);
    // 戻すと、選び直さなくても、また選ばれている
    const back = syncForMonth({ ...moved, date: '2026-11-05' }, c);
    assert.equal(back.payerMemberId, 'm2');
    assert.equal(checkDraft(back, c).canSave, true);
  });

  it('選べる支払者は、そのまま', () => {
    const c = ctx();
    assert.equal(syncForMonth({ ...draft(c, { payerMemberId: 'm1' }), date: '2026-10-05' }, c).payerMemberId, 'm1');
  });

  it('登録できる月が無いときは、支払者より先に、その案内を出す', () => {
    const c = context({ registerableMonths: [] });
    const d = { ...initialDraft(c, null), amount: '1200' };
    assert.equal(d.payerMemberId, null);
    assert.equal(checkDraft(d, c).blocker, '登録できる月がありません。');
  });

  it('検査でも、選べない支払者を保存させない', () => {
    const c = ctx();
    const bad = draft(c, { payerMemberId: 'm2', date: '2026-10-05' });
    const check = checkDraft(bad, c);
    assert.equal(check.canSave, false);
    assert.equal(check.blocker, '支払った人を選び直してください。');
  });

  it('編集で開いた支出の支払者は、その月で選べなくても、変えなければ保存できる', () => {
    const left = member('m3', { status: 'left' });
    const c = context({ members: [member('m1'), member('m2'), left] }, detail({ payerMemberId: 'm3' }));
    const d = initialDraft(c, null);
    assert.equal(syncForMonth({ ...d, description: 'x' }, c).payerMemberId, 'm3');
    assert.equal(checkDraft(d, c).canSave, true);
  });
});

describe('編集で「金額を指定する」へ切り替えたときの初期値', () => {
  it('保存された負担額が入る（割合・均等の支出から切り替えても）', () => {
    const ctx = context(
      {},
      detail({
        splitMethod: 'ratio',
        allocations: [
          { memberId: 'm1', burdenMinor: 2996, shareBasisPoints: 7000 },
          { memberId: 'm2', burdenMinor: 1284, shareBasisPoints: 3000 },
        ],
      }),
    );
    const base = initialDraft(ctx, null);
    assert.deepEqual(base.split?.amounts, { m1: '2996', m2: '1284' });
    // そのまま切り替えると、合計が金額と一致して、保存の検査に通る（案内した回避策が使える）
    const switched = { ...base, split: { ...base.split!, method: 'fixed' as const } };
    assert.equal(checkDraft(switched, ctx).split?.ok, true);
  });

  it('負担額が0の行は、空欄', () => {
    const ctx = context(
      {},
      detail({
        splitMethod: 'equal',
        allocations: [
          { memberId: 'm1', burdenMinor: 4280, shareBasisPoints: null },
          { memberId: 'm2', burdenMinor: 0, shareBasisPoints: null },
        ],
      }),
    );
    assert.deepEqual(initialDraft(ctx, null).split?.amounts, { m1: '4280', m2: '' });
  });
});

describe('splitMemberIdsOf', () => {
  it('送る負担に入るメンバー（費目の割合なら空）', () => {
    const ctx = context();
    assert.deepEqual(splitMemberIdsOf(draft(ctx), ctx), []);
    assert.deepEqual(splitMemberIdsOf(draft(ctx, { split: split({ method: 'single', singleId: 'm2' }) }), ctx), ['m2']);
    assert.deepEqual(
      splitMemberIdsOf(draft(ctx, { split: split({ method: 'ratio', percents: { m1: '100', m2: '0' } }) }), ctx),
      ['m1'],
    );
  });
});
