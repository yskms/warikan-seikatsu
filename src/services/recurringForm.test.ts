// 固定費の登録・編集シートの入力の状態・検査・リクエストの組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { Category, MonthListItem } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import {
  buildCreateRequest,
  buildRecurringContext,
  buildUpdatePlan,
  categoryOptions,
  checkDraft,
  endMonthRange,
  firstTargetMonth,
  initialDraft,
  payerOptions,
  resumeBlocker,
  setStartMonth,
  splitLocked,
  splitMemberIdsOf,
  splitMembers,
  startMonthRange,
  stepMonth,
  toggleCustomSplit,
  toggleEndMonth,
  type RecurringDraft,
  type RecurringFormContext,
} from './recurringForm.ts';

function member(id: string, extra: Partial<GroupMember> = {}): GroupMember {
  return {
    id,
    displayName: id === 'm1' ? 'あなた' : id === 'm2' ? '彼女' : id,
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-01',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
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
  { month: '2026-12', status: 'open' },
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
    leaveDeletesGroup: false,
    seatedMembers: 2,
    maxMembers: 5,
    canInvite: true,
    members: [member('m1'), member('m2')],
    ...extra,
  };
}

function recurring(extra: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'r1',
    description: '家賃',
    amountMinor: 80000,
    categoryId: 'c1',
    categoryArchived: false,
    payerMemberId: 'm1',
    split: { method: 'category' },
    dayOfMonth: 25,
    startMonth: '2026-11',
    endMonth: null,
    pausedAt: null,
    pausedReason: null,
    ...extra,
  };
}

function context(
  editing: RecurringExpense | null = null,
  options: { group?: GroupDetail; months?: MonthListItem[]; currentMonth?: string } = {},
): RecurringFormContext {
  return buildRecurringContext(
    {
      group: options.group ?? group(),
      months: { currentMonth: options.currentMonth ?? '2026-11', months: options.months ?? months },
      categories,
      recurring: editing === null ? [] : [editing],
    },
    editing,
  );
}

/** 新規の入力で、必須の項目（金額・日）を入れたもの */
function filled(ctx: RecurringFormContext, extra: Partial<RecurringDraft> = {}): RecurringDraft {
  return { ...initialDraft(ctx), amount: '80000', dayOfMonth: 25, ...extra };
}

describe('firstTargetMonth', () => {
  it('開始する月と今月の遅いほう。それが未締めならその月', () => {
    const ctx = context();
    assert.equal(firstTargetMonth('2026-11', ctx), '2026-11');
    assert.equal(firstTargetMonth('2026-12', ctx), '2026-12');
    // 開始する月が過去でも、作るのは今月の分から
    assert.equal(firstTargetMonth('2026-01', ctx), '2026-11');
  });

  it('今月が早めに締められていれば、最も古い未締めの月', () => {
    const ctx = context(null, {
      months: [
        { month: '2026-10', status: 'settled' },
        { month: '2026-11', status: 'unsettled' },
        { month: '2026-12', status: 'open' },
      ],
    });
    assert.equal(firstTargetMonth('2026-11', ctx), '2026-12');
    assert.equal(firstTargetMonth('2026-12', ctx), '2026-12');
  });

  it('月の一覧に無い先の月は、その月のまま', () => {
    assert.equal(firstTargetMonth('2027-03', context()), '2027-03');
  });
});

describe('選択肢', () => {
  it('支払う人は、その月に使えるメンバーだけ。編集で開いた固定費の支払う人は、使えなくても含める', () => {
    const left = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const ctx = context(null, { group: group({ members: [member('m1'), left] }) });
    assert.deepEqual(payerOptions(ctx, '2026-11').map((m) => m.id), ['m1']);
    const editing = context(recurring({ payerMemberId: 'm2' }), { group: group({ members: [member('m1'), left] }) });
    assert.deepEqual(payerOptions(editing, '2026-11').map((m) => m.id), ['m1', 'm2']);
  });

  it('負担の対象は、使えるメンバーと、もともとの負担に入っているメンバー', () => {
    const left = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const members = [member('m1'), left];
    assert.deepEqual(splitMembers(context(null, { group: group({ members }) }), '2026-11').map((m) => m.id), ['m1']);
    const editing = context(recurring({ split: { method: 'equal', memberIds: ['m1', 'm2'] } }), { group: group({ members }) });
    assert.deepEqual(splitMembers(editing, '2026-11').map((m) => m.id), ['m1', 'm2']);
  });

  it('カテゴリは、アーカイブしたものを選べない。編集で開いた固定費のカテゴリは、アーカイブしていても含める', () => {
    assert.deepEqual(categoryOptions(context()).map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(categoryOptions(context(recurring({ categoryId: 'c3', categoryArchived: true }))).map((c) => c.id), ['c1', 'c2', 'c3']);
  });
});

describe('月の選択', () => {
  it('開始する月は今月から。編集では、保存された月が過去ならそこから', () => {
    const range = startMonthRange(context());
    assert.deepEqual(range, { min: '2026-11', max: '2028-11' });
    assert.equal(startMonthRange(context(recurring({ startMonth: '2026-04' }))).min, '2026-04');
    assert.equal(startMonthRange(context(recurring({ startMonth: '2027-01' }))).min, '2026-11');
  });

  it('終了する月は、開始する月から先', () => {
    const draft = filled(context(), { startMonth: '2026-12' });
    assert.deepEqual(endMonthRange(draft), { min: '2026-12', max: '2036-12' });
  });

  it('範囲の外へは、ずらせない', () => {
    const range = { min: '2026-11', max: '2027-01' };
    assert.equal(stepMonth('2026-11', 1, range), '2026-12');
    assert.equal(stepMonth('2026-11', -1, range), null);
    assert.equal(stepMonth('2027-01', 1, range), null);
    assert.equal(stepMonth('2026-12', 12, range), null);
  });

  it('開始する月を、終了する月より後にすると、終了する月を開始する月に合わせる', () => {
    const ctx = context();
    const draft = filled(ctx, { endMonth: '2026-12' });
    assert.equal(setStartMonth(draft, '2027-02', ctx).endMonth, '2027-02');
    assert.equal(setStartMonth(draft, '2026-12', ctx).endMonth, '2026-12');
    assert.equal(setStartMonth({ ...draft, endMonth: null }, '2027-02', ctx).endMonth, null);
  });

  it('終了する月を決める・外す。決めるときは、1年先（開始する月か今月の遅いほうから）', () => {
    const ctx = context();
    const on = toggleEndMonth(filled(ctx), ctx);
    assert.equal(on.endMonth, '2027-10');
    assert.equal(toggleEndMonth(on, ctx).endMonth, null);
    assert.equal(toggleEndMonth(filled(ctx, { startMonth: '2027-02' }), ctx).endMonth, '2028-01');
  });

  it('開始する月を変えると、負担の入力を、その月に選べるメンバーに合わせる', () => {
    const leaving = member('m2', { leaveRequestedMonth: '2026-11' });
    const ctx = context(null, { group: group({ members: [member('m1'), leaving] }) });
    const custom = toggleCustomSplit(filled(ctx), ctx);
    assert.deepEqual(custom.split?.equalIds, ['m1', 'm2']);
    // 12月には、11月で脱退する人は選べない
    const moved = setStartMonth(custom, '2026-12', ctx);
    assert.deepEqual(moved.split?.equalIds, ['m1']);
    assert.deepEqual(Object.keys(moved.split?.percents ?? {}), ['m1']);
  });
});

describe('initialDraft', () => {
  it('新規は、今月から・自分が支払う・先頭のカテゴリ。日と金額は空', () => {
    const ctx = context();
    assert.deepEqual(initialDraft(ctx), {
      amount: '',
      categoryId: 'c1',
      payerMemberId: 'm1',
      dayOfMonth: null,
      description: '',
      startMonth: '2026-11',
      endMonth: null,
      split: null,
    });
  });

  it('新規で、自分が支払う人に選べないとき（脱退を選んだ月が終わっている）は、支払う人を選ばない', () => {
    const ctx = context(null, {
      group: group({ members: [member('m1', { status: 'left', expenseEndMonth: '2026-10' }), member('m2')] }),
    });
    assert.equal(initialDraft(ctx).payerMemberId, null);
  });

  it('編集は、保存されている値', () => {
    const ctx = context(
      recurring({ description: null, amountMinor: 80000, dayOfMonth: 31, endMonth: '2027-03', split: { method: 'single', memberId: 'm2' } }),
    );
    const draft = initialDraft(ctx);
    assert.equal(draft.amount, '80000');
    assert.equal(draft.categoryId, 'c1');
    assert.equal(draft.dayOfMonth, 31);
    assert.equal(draft.description, '');
    assert.equal(draft.endMonth, '2027-03');
    assert.equal(draft.split?.method, 'single');
    assert.equal(draft.split?.singleId, 'm2');
  });

  it('編集で、負担の方法をアプリが読めない固定費は、負担を持たず、変えられない', () => {
    const ctx = context(recurring({ split: null }));
    assert.equal(splitLocked(ctx), true);
    assert.equal(initialDraft(ctx).split, null);
    assert.equal(splitLocked(context()), false);
    assert.equal(splitLocked(context(recurring())), false);
  });
});

describe('checkDraft', () => {
  it('必須の項目が揃えば保存できる。保存ボタンに金額を出す', () => {
    const ctx = context();
    const check = checkDraft(filled(ctx), ctx);
    assert.equal(check.canSave, true);
    assert.equal(check.blocker, null);
    assert.equal(check.saveLabel, '登録 ¥80,000');
    assert.equal(checkDraft(filled(context(recurring())), context(recurring())).saveLabel, '保存 ¥80,000');
  });

  it('金額が空のときは、案内を出さずに保存できない', () => {
    const ctx = context();
    const check = checkDraft(filled(ctx, { amount: '' }), ctx);
    assert.equal(check.canSave, false);
    assert.equal(check.blocker, null);
    assert.equal(check.saveLabel, '登録');
  });

  it('金額・日・カテゴリ・支払う人・内容・終了する月の、保存できない理由', () => {
    const ctx = context();
    assert.match(checkDraft(filled(ctx, { amount: '0' }), ctx).blocker ?? '', /1以上/);
    assert.match(checkDraft(filled(ctx, { amount: '5/0' }), ctx).blocker ?? '', /計算できません/);
    assert.equal(checkDraft(filled(ctx, { dayOfMonth: null }), ctx).blocker, '毎月の日を選んでください。');
    assert.equal(checkDraft(filled(ctx, { categoryId: null }), ctx).blocker, 'カテゴリを選んでください。');
    assert.equal(checkDraft(filled(ctx, { payerMemberId: null }), ctx).blocker, '支払う人を選んでください。');
    assert.match(checkDraft(filled(ctx, { description: 'あ'.repeat(101) }), ctx).blocker ?? '', /100文字/);
    assert.equal(checkDraft(filled(ctx, { description: 'あ'.repeat(100) }), ctx).canSave, true);
    assert.equal(
      checkDraft(filled(ctx, { endMonth: '2026-10' }), ctx).blocker,
      '終了する月は、開始する月以降にしてください。',
    );
    assert.equal(checkDraft(filled(ctx, { endMonth: '2026-11' }), ctx).canSave, true);
  });

  it('最初に支出を作る月に選べない支払う人は、選び直してもらう', () => {
    const leaving = member('m2', { leaveRequestedMonth: '2026-11' });
    const ctx = context(null, { group: group({ members: [member('m1'), leaving] }) });
    assert.equal(checkDraft(filled(ctx, { payerMemberId: 'm2' }), ctx).canSave, true);
    // 12月から作る固定費の支払う人に、11月で脱退する人は選べない
    const later = setStartMonth(filled(ctx, { payerMemberId: 'm2' }), '2026-12', ctx);
    assert.equal(checkDraft(later, ctx).blocker, '支払う人を選び直してください。');
  });

  it('負担の指定の検査の結果が、保存できない理由になる', () => {
    const ctx = context();
    const custom = toggleCustomSplit(filled(ctx), ctx);
    assert.equal(checkDraft(custom, ctx).canSave, true);
    const bad = { ...custom, split: { ...custom.split!, equalIds: [] } };
    assert.equal(checkDraft(bad, ctx).blocker, '負担する人を、1人以上選んでください。');
    const fixed = { ...custom, split: { ...custom.split!, method: 'fixed' as const, amounts: { m1: '50000', m2: '20000' } } };
    assert.match(checkDraft(fixed, ctx).blocker ?? '', /合計が¥80,000になるように/);
    const fixedOk = { ...fixed, split: { ...fixed.split, amounts: { m1: '50000', m2: '30000' } } };
    assert.equal(checkDraft(fixedOk, ctx).canSave, true);
  });

  it('編集で、負担の方法をアプリが読めない固定費は、金額を変えられない（ほかの項目は直せる）', () => {
    const ctx = context(recurring({ split: null }));
    const draft = initialDraft(ctx);
    assert.equal(checkDraft(draft, ctx).canSave, true);
    assert.equal(checkDraft({ ...draft, dayOfMonth: 10 }, ctx).canSave, true);
    assert.match(checkDraft({ ...draft, amount: '90000' }, ctx).blocker ?? '', /金額は変えられません/);
  });
});

describe('buildCreateRequest', () => {
  it('登録の本文。内容・終了する月は、あるときだけ。通貨を添える', () => {
    const ctx = context();
    assert.deepEqual(buildCreateRequest(filled(ctx), ctx), {
      amountMinor: 80000,
      categoryId: 'c1',
      payerMemberId: 'm1',
      split: { method: 'category' },
      dayOfMonth: 25,
      startMonth: '2026-11',
      currencyCode: 'JPY',
    });
    assert.deepEqual(buildCreateRequest(filled(ctx, { description: '  家賃  ', endMonth: '2027-10', startMonth: '2026-12' }), ctx), {
      description: '家賃',
      amountMinor: 80000,
      categoryId: 'c1',
      payerMemberId: 'm1',
      split: { method: 'category' },
      dayOfMonth: 25,
      startMonth: '2026-12',
      endMonth: '2027-10',
      currencyCode: 'JPY',
    });
  });

  it('負担を変える入力は、使えるメンバーだけで組み立てる（割合・均等・金額指定・1人）', () => {
    const ctx = context();
    const custom = toggleCustomSplit(filled(ctx), ctx);
    assert.deepEqual(buildCreateRequest(custom, ctx)?.split, { method: 'equal', memberIds: ['m1', 'm2'] });
    const ratio = { ...custom, split: { ...custom.split!, method: 'ratio' as const, percents: { m1: '70', m2: '30' } } };
    assert.deepEqual(buildCreateRequest(ratio, ctx)?.split, {
      method: 'ratio',
      shares: [
        { memberId: 'm1', basisPoints: 7000 },
        { memberId: 'm2', basisPoints: 3000 },
      ],
    });
    // 0%・0円のメンバーは送らない
    const zero = { ...custom, split: { ...custom.split!, method: 'ratio' as const, percents: { m1: '100', m2: '0' } } };
    assert.deepEqual(buildCreateRequest(zero, ctx)?.split, { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 10000 }] });
    const fixed = { ...custom, split: { ...custom.split!, method: 'fixed' as const, amounts: { m1: '50000', m2: '30000' } } };
    assert.deepEqual(buildCreateRequest(fixed, ctx)?.split, {
      method: 'fixed',
      amounts: [
        { memberId: 'm1', amountMinor: 50000 },
        { memberId: 'm2', amountMinor: 30000 },
      ],
    });
    const single = { ...custom, split: { ...custom.split!, method: 'single' as const, singleId: 'm2' } };
    assert.deepEqual(buildCreateRequest(single, ctx)?.split, { method: 'single', memberId: 'm2' });
  });

  it('保存できない入力は `null`', () => {
    const ctx = context();
    assert.equal(buildCreateRequest(filled(ctx, { dayOfMonth: null }), ctx), null);
    assert.equal(buildCreateRequest(filled(ctx, { amount: '' }), ctx), null);
  });

  it('通貨の小数桁数に合わせて、最小単位にする（USD）', () => {
    const ctx = context(null, { group: group({ currencyCode: 'USD', currencyMinorUnit: 2 }) });
    const request = buildCreateRequest(filled(ctx, { amount: '12.5' }), ctx);
    assert.equal(request?.amountMinor, 1250);
    assert.equal(request?.currencyCode, 'USD');
  });

  it('断られたとき文言を決めるための、負担に入るメンバー', () => {
    const ctx = context();
    assert.deepEqual(splitMemberIdsOf(filled(ctx), ctx), []);
    assert.deepEqual(splitMemberIdsOf(toggleCustomSplit(filled(ctx), ctx), ctx), ['m1', 'm2']);
  });
});

describe('buildUpdatePlan', () => {
  it('何も変えていなければ `unchanged`', () => {
    const ctx = context(recurring());
    assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx), { kind: 'unchanged' });
  });

  it('変えたものだけを送る（内容・日・開始・終了）。内容を消すと `null`、終了する月を外すと `null`', () => {
    const ctx = context(recurring({ endMonth: '2027-03' }));
    const base = initialDraft(ctx);
    assert.deepEqual(buildUpdatePlan({ ...base, dayOfMonth: 1 }, ctx), { kind: 'request', request: { dayOfMonth: 1 } });
    assert.deepEqual(buildUpdatePlan({ ...base, description: '住居費' }, ctx), { kind: 'request', request: { description: '住居費' } });
    assert.deepEqual(buildUpdatePlan({ ...base, description: '  ' }, ctx), { kind: 'request', request: { description: null } });
    assert.deepEqual(buildUpdatePlan({ ...base, endMonth: null }, ctx), { kind: 'request', request: { endMonth: null } });
    assert.deepEqual(buildUpdatePlan({ ...base, startMonth: '2026-12' }, ctx), { kind: 'request', request: { startMonth: '2026-12' } });
    assert.deepEqual(buildUpdatePlan({ ...base, categoryId: 'c2' }, ctx), { kind: 'request', request: { categoryId: 'c2' } });
  });

  it('内容が無い固定費で、内容を入れていなければ変えない（空と `null` は同じ）', () => {
    const ctx = context(recurring({ description: null }));
    assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx), { kind: 'unchanged' });
  });

  it('金額を変えるときは通貨を添える。カテゴリの割合・割合・均等・1人の固定費は、金額だけ変えて、負担を送らない', () => {
    for (const split of [
      { method: 'category' as const },
      { method: 'ratio' as const, shares: [{ memberId: 'm1', basisPoints: 7000 }, { memberId: 'm2', basisPoints: 3000 }] },
      { method: 'equal' as const, memberIds: ['m1', 'm2'] },
      { method: 'single' as const, memberId: 'm2' },
    ]) {
      const ctx = context(recurring({ split }));
      const draft = { ...initialDraft(ctx), amount: '85000' };
      assert.deepEqual(buildUpdatePlan(draft, ctx), { kind: 'request', request: { amountMinor: 85000, currencyCode: 'JPY' } }, split.method);
    }
  });

  it('金額指定の固定費は、金額を変えるとき、負担も送る', () => {
    const ctx = context(
      recurring({
        split: {
          method: 'fixed',
          amounts: [
            { memberId: 'm1', amountMinor: 50000 },
            { memberId: 'm2', amountMinor: 30000 },
          ],
        },
      }),
    );
    const base = initialDraft(ctx);
    // 金額だけ変えて、負担の合計が合わない
    assert.match(checkDraft({ ...base, amount: '90000' }, ctx).blocker ?? '', /合計が¥90,000になるように/);
    assert.deepEqual(buildUpdatePlan({ ...base, amount: '90000' }, ctx), { kind: 'invalid' });
    const draft = { ...base, amount: '90000', split: { ...base.split!, amounts: { m1: '60000', m2: '30000' } } };
    assert.deepEqual(buildUpdatePlan(draft, ctx), {
      kind: 'request',
      request: {
        amountMinor: 90000,
        currencyCode: 'JPY',
        split: {
          method: 'fixed',
          amounts: [
            { memberId: 'm1', amountMinor: 60000 },
            { memberId: 'm2', amountMinor: 30000 },
          ],
        },
      },
    });
  });

  it('負担を変えたとき・カテゴリの割合に戻したときは、負担を送る', () => {
    const ctx = context(recurring());
    const custom = toggleCustomSplit(initialDraft(ctx), ctx);
    assert.deepEqual(buildUpdatePlan(custom, ctx), {
      kind: 'request',
      request: { split: { method: 'equal', memberIds: ['m1', 'm2'] } },
    });
    const withSingle = context(recurring({ split: { method: 'single', memberId: 'm2' } }));
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(withSingle), split: null }, withSingle), {
      kind: 'request',
      request: { split: { method: 'category' } },
    });
  });

  it('負担を変えていなければ、もともと負担にいた人の0%の行も、変えたことにしない', () => {
    const ctx = context(recurring({ split: { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 10000 }, { memberId: 'm2', basisPoints: 0 }] } }));
    assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx), { kind: 'unchanged' });
  });

  it('もとの負担に0%の行があっても、変えていなければ負担を送らない（日だけ直せる）', () => {
    const leftMember = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const split = { method: 'ratio' as const, shares: [{ memberId: 'm1', basisPoints: 10000 }, { memberId: 'm2', basisPoints: 0 }] };
    const ctx = context(recurring({ split, pausedAt: 1, pausedReason: 'member_changed' }), { group: group({ members: [member('m1'), leftMember] }) });
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(ctx), dayOfMonth: 3 }, ctx), { kind: 'request', request: { dayOfMonth: 3 } });
  });

  it('使えなくなったメンバーを0%にして直したときは、そのメンバーの行を送らない（止めたまま保存できる）', () => {
    const leftMember = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const split = { method: 'ratio' as const, shares: [{ memberId: 'm1', basisPoints: 5000 }, { memberId: 'm2', basisPoints: 5000 }] };
    const ctx = context(recurring({ split, pausedAt: 1, pausedReason: 'member_changed' }), { group: group({ members: [member('m1'), leftMember] }) });
    const base = initialDraft(ctx);
    const draft = { ...base, split: { ...base.split!, percents: { m1: '100', m2: '0' } } };
    assert.deepEqual(buildUpdatePlan(draft, ctx), {
      kind: 'request',
      request: { split: { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 10000 }] } },
    });
  });

  it('金額指定の固定費の金額を変えるときも、0円の行は送らない', () => {
    const leftMember = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const split = { method: 'fixed' as const, amounts: [{ memberId: 'm1', amountMinor: 3000 }, { memberId: 'm2', amountMinor: 0 }] };
    const ctx = context(recurring({ amountMinor: 3000, split }), { group: group({ members: [member('m1'), leftMember] }) });
    const base = initialDraft(ctx);
    const draft = { ...base, amount: '4000', split: { ...base.split!, amounts: { m1: '4000', m2: '' } } };
    assert.deepEqual(buildUpdatePlan(draft, ctx), {
      kind: 'request',
      request: { amountMinor: 4000, currencyCode: 'JPY', split: { method: 'fixed', amounts: [{ memberId: 'm1', amountMinor: 4000 }] } },
    });
  });

  it('開始する月を動かして元に戻しても、入力は変わっていない（均等・割合・1人・金額指定）', () => {
    for (const split of [
      { method: 'equal' as const, memberIds: ['m1', 'm2'] },
      { method: 'ratio' as const, shares: [{ memberId: 'm1', basisPoints: 7000 }, { memberId: 'm2', basisPoints: 3000 }] },
      { method: 'single' as const, memberId: 'm2' },
      { method: 'fixed' as const, amounts: [{ memberId: 'm1', amountMinor: 50000 }, { memberId: 'm2', amountMinor: 30000 }] },
    ]) {
      const ctx = context(recurring({ amountMinor: 80000, split }));
      const base = initialDraft(ctx);
      const moved = setStartMonth(base, '2026-12', ctx);
      assert.deepEqual(setStartMonth(moved, '2026-11', ctx), base, split.method);
      assert.deepEqual(buildUpdatePlan(setStartMonth(moved, '2026-11', ctx), ctx), { kind: 'unchanged' }, split.method);
    }
  });

  it('負担の方法をアプリが読めない固定費は、負担を送らない（ほかの項目は直せる）', () => {
    const ctx = context(recurring({ split: null }));
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(ctx), dayOfMonth: 5 }, ctx), { kind: 'request', request: { dayOfMonth: 5 } });
  });

  it('使えなくなった支払う人のままでも、ほかの項目は直せる（支払う人は送らない）', () => {
    const left = member('m2', { status: 'left', expenseEndMonth: '2026-10' });
    const ctx = context(recurring({ payerMemberId: 'm2', pausedAt: 1, pausedReason: 'payer_left' }), {
      group: group({ members: [member('m1'), left] }),
    });
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(ctx), dayOfMonth: 3 }, ctx), { kind: 'request', request: { dayOfMonth: 3 } });
    // 付け替えは送る
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(ctx), payerMemberId: 'm1' }, ctx), {
      kind: 'request',
      request: { payerMemberId: 'm1' },
    });
  });

  it('検査に通らない入力は `invalid`', () => {
    const ctx = context(recurring());
    assert.deepEqual(buildUpdatePlan({ ...initialDraft(ctx), amount: '' }, ctx), { kind: 'invalid' });
    assert.deepEqual(buildUpdatePlan(initialDraft(context()), context()), { kind: 'invalid' });
  });
});

describe('再開', () => {
  const leftMember = member('m2', { status: 'left', expenseEndMonth: '2026-10' });

  it('カテゴリの割合の固定費は、`paused: false` だけで再開できる（変更があれば一緒に送る）', () => {
    const ctx = context(recurring({ pausedAt: 1, pausedReason: 'manual' }));
    const base = initialDraft(ctx);
    assert.equal(resumeBlocker(base, ctx), null);
    assert.deepEqual(buildUpdatePlan(base, ctx, { resume: true }), { kind: 'request', request: { paused: false } });
    assert.deepEqual(buildUpdatePlan({ ...base, dayOfMonth: 1 }, ctx, { resume: true }), {
      kind: 'request',
      request: { dayOfMonth: 1, paused: false },
    });
  });

  it('負担を変えている固定費は、変えていなくても、負担を送り直す（止めた理由によらず）', () => {
    for (const reason of ['manual', 'member_changed', 'payer_left'] as const) {
      const ctx = context(recurring({ pausedAt: 1, pausedReason: reason, split: { method: 'equal', memberIds: ['m1', 'm2'] } }));
      assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx, { resume: true }), {
        kind: 'request',
        request: { split: { method: 'equal', memberIds: ['m1', 'm2'] }, paused: false },
      });
    }
  });

  it('再開では、使えなくなったメンバーの0%の行は残さない', () => {
    const members = [member('m1'), leftMember];
    const split = { method: 'ratio' as const, shares: [{ memberId: 'm1', basisPoints: 10000 }, { memberId: 'm2', basisPoints: 0 }] };
    const ctx = context(recurring({ pausedAt: 1, pausedReason: 'member_changed', split }), { group: group({ members }) });
    assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx, { resume: true }), {
      kind: 'request',
      request: { split: { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 10000 }] }, paused: false },
    });
  });

  it('支払う人が使えないままでは、再開できない。付け替えれば再開できる', () => {
    const members = [member('m1'), leftMember];
    const ctx = context(recurring({ payerMemberId: 'm2', pausedAt: 1, pausedReason: 'payer_left' }), { group: group({ members }) });
    const base = initialDraft(ctx);
    assert.match(resumeBlocker(base, ctx) ?? '', /支払う人を選び直してください/);
    assert.deepEqual(buildUpdatePlan(base, ctx, { resume: true }), { kind: 'invalid' });
    assert.deepEqual(buildUpdatePlan({ ...base, payerMemberId: 'm1' }, ctx, { resume: true }), {
      kind: 'request',
      request: { payerMemberId: 'm1', paused: false },
    });
  });

  it('負担の対象に、使えないメンバーが金額つきで残っていれば、再開できない', () => {
    const members = [member('m1'), leftMember];
    const split = { method: 'single' as const, memberId: 'm2' };
    const ctx = context(recurring({ pausedAt: 1, pausedReason: 'payer_left', split }), { group: group({ members }) });
    assert.match(resumeBlocker(initialDraft(ctx), ctx) ?? '', /使えないメンバー/);
  });

  it('カテゴリが使わない設定のままでは、再開できない。選び直せば再開できる', () => {
    const ctx = context(recurring({ categoryId: 'c3', categoryArchived: true, pausedAt: 1, pausedReason: 'manual' }));
    const base = initialDraft(ctx);
    assert.match(resumeBlocker(base, ctx) ?? '', /カテゴリが「使わない」設定/);
    assert.deepEqual(buildUpdatePlan({ ...base, categoryId: 'c2' }, ctx, { resume: true }), {
      kind: 'request',
      request: { categoryId: 'c2', paused: false },
    });
  });

  it('負担の方法をアプリが読めない固定費は、再開できない', () => {
    const ctx = context(recurring({ split: null, pausedAt: 1, pausedReason: 'manual' }));
    assert.match(resumeBlocker(initialDraft(ctx), ctx) ?? '', /アプリを最新の版に更新/);
    assert.deepEqual(buildUpdatePlan(initialDraft(ctx), ctx, { resume: true }), { kind: 'invalid' });
  });

  it('新規の入力には、再開できない理由が無い', () => {
    const ctx = context();
    assert.equal(resumeBlocker(filled(ctx), ctx), null);
  });
});
