// カテゴリの編集の入力の規則のテスト。`npm test` で実行する。負担額の計算は、ここでは確かめない（Workerだけが計算する）。
// 入力の形の検査と、リクエストの組み立てだけを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CategoryShareRule } from '../domain/categoryShare.ts';
import type { Category } from '../domain/month.ts';
import { CATEGORY_ICON_KEYS } from '../theme/categoryIcons.ts';
import {
  applyEqual,
  applyPreset,
  buildCreateInput,
  buildSavePlan,
  canEditShares,
  CATEGORY_COLOR_KEYS,
  checkDraft,
  draftFromCategory,
  enableCap,
  hasChanges,
  MAX_CATEGORY_NAME_LENGTH,
  newDraft,
  setCapMember,
  setPercentText,
  type CategoryDraft,
  type CategoryFormContext,
} from './categoryForm.ts';

const category: Category = { id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false };
const rule = (shares: [string, number][], cap: CategoryShareRule['cap'] = null): CategoryShareRule => ({
  categoryId: 'c1',
  sourceMonth: '2026-10',
  shares: shares.map(([memberId, basisPoints]) => ({ memberId, basisPoints })),
  cap,
  archived: false,
});
const twoMembers = rule([['m1', 7000], ['m2', 3000]]);
const ctxOf = (overrides: Partial<CategoryFormContext> = {}): CategoryFormContext => ({
  memberOrder: ['m1', 'm2'],
  minorUnit: 0,
  currencyCode: 'JPY',
  editing: category,
  rule: twoMembers,
  shareEditable: true,
  ...overrides,
});
const draftOf = (ctx: CategoryFormContext = ctxOf()): CategoryDraft => draftFromCategory(category, ctx.rule, ctx);

describe('選べるアイコンと色', () => {
  it('アイコンは、サーバーが受け付ける形（英小文字・数字・_・-の30字まで）で、重ならない', () => {
    assert.ok(CATEGORY_ICON_KEYS.length >= 30);
    assert.equal(new Set(CATEGORY_ICON_KEYS).size, CATEGORY_ICON_KEYS.length);
    for (const key of CATEGORY_ICON_KEYS) assert.match(key, /^[a-z0-9][a-z0-9_-]{0,29}$/);
  });

  it('初期の費目のアイコン（Workerの DEFAULT_CATEGORIES）を含む。公開後に変えない', () => {
    for (const key of ['home', 'cart', 'detergent', 'bulb', 'utensils', 'wifi', 'more']) {
      assert.ok((CATEGORY_ICON_KEYS as string[]).includes(key), key);
    }
  });

  it('色は、メンバーの色と同じ10色', () => {
    assert.equal(CATEGORY_COLOR_KEYS.length, 10);
    for (const key of CATEGORY_COLOR_KEYS) assert.match(key, /^[a-z0-9][a-z0-9_-]{0,29}$/);
  });
});

describe('newDraft', () => {
  it('既存のカテゴリと重ならないアイコン・色を先に選ぶ', () => {
    const draft = newDraft([category, { ...category, id: 'c2', icon: 'cart', color: 'green' }]);
    assert.ok(!['home', 'cart'].includes(draft.icon));
    assert.ok(!['blue', 'green'].includes(draft.color));
    assert.equal(draft.name, '');
    assert.equal(draft.capEnabled, false);
  });

  it('すべて使われていたら、先頭', () => {
    const all = CATEGORY_ICON_KEYS.map((icon, index): Category => ({ ...category, id: `c${index}`, icon, color: CATEGORY_COLOR_KEYS[index % 10]! }));
    const draft = newDraft(all);
    assert.equal(draft.icon, CATEGORY_ICON_KEYS[0]);
    assert.equal(draft.color, CATEGORY_COLOR_KEYS[0]);
  });
});

describe('draftFromCategory', () => {
  it('いまの値を、入力欄の文字にする', () => {
    const draft = draftOf();
    assert.deepEqual(draft, {
      name: '家賃',
      icon: 'home',
      color: 'blue',
      percents: { m1: '70', m2: '30' },
      capEnabled: false,
      capMemberId: null,
      capAmount: '',
    });
  });

  it('上限額つきは、上限の人と金額を入れる。通貨の小数桁数に合わせる', () => {
    const capped = rule([['m1', 0], ['m2', 10000]], { memberId: 'm1', capMinor: 1234 });
    const draft = draftFromCategory(category, capped, { memberOrder: ['m1', 'm2'], minorUnit: 2 });
    assert.equal(draft.capEnabled, true);
    assert.equal(draft.capMemberId, 'm1');
    assert.equal(draft.capAmount, '12.34');
  });

  it('割合が無いメンバーは0%（割合に入っているメンバーの順で出す）', () => {
    const draft = draftFromCategory(category, rule([['m1', 10000]]), { memberOrder: ['m1', 'm2'], minorUnit: 0 });
    assert.deepEqual(draft.percents, { m1: '100', m2: '0' });
  });
});

describe('割合の操作', () => {
  it('2人のとき、先頭の人の割合を決めると、残りがもう1人になる', () => {
    const draft = applyPreset(draftOf(), ctxOf(), 6000);
    assert.deepEqual(draft.percents, { m1: '60', m2: '40' });
    assert.deepEqual(applyPreset(draftOf(), ctxOf(), 10000).percents, { m1: '100', m2: '0' });
  });

  it('3人以上では、ボタン（先頭の人の割合）は使えない（何も変えない）', () => {
    const ctx = ctxOf({ memberOrder: ['m1', 'm2', 'm3'] });
    const draft = draftOf(ctx);
    assert.equal(applyPreset(draft, ctx, 6000), draft);
  });

  it('全員を均等にする（端数は先頭から0.01%ずつ）', () => {
    const ctx = ctxOf({ memberOrder: ['m1', 'm2', 'm3'], rule: rule([['m1', 5000], ['m2', 3000], ['m3', 2000]]) });
    assert.deepEqual(applyEqual(draftOf(ctx), ctx).percents, { m1: '33.34', m2: '33.33', m3: '33.33' });
    assert.deepEqual(applyEqual(draftOf(), ctxOf()).percents, { m1: '50', m2: '50' });
  });

  it('2人のとき、1人の欄を直すと、もう1人が残りになる', () => {
    const draft = setPercentText(draftOf(), ctxOf(), 'm2', '45');
    assert.deepEqual(draft.percents, { m1: '55', m2: '45' });
    assert.deepEqual(setPercentText(draftOf(), ctxOf(), 'm1', '33.5').percents, { m1: '33.5', m2: '66.5' });
  });

  it('入力の途中（読めない文字・100%超）では、もう1人は変えない。文字は数字と小数点だけ', () => {
    assert.deepEqual(setPercentText(draftOf(), ctxOf(), 'm1', '').percents, { m1: '', m2: '30' });
    assert.deepEqual(setPercentText(draftOf(), ctxOf(), 'm1', '150').percents, { m1: '150', m2: '30' });
    assert.deepEqual(setPercentText(draftOf(), ctxOf(), 'm1', '3a3,5').percents, { m1: '33.5', m2: '66.5' });
    assert.deepEqual(setPercentText(draftOf(), ctxOf(), 'm1', '1.234').percents, { m1: '1.234', m2: '30' });
  });

  it('3人以上は、その人の欄だけを直す', () => {
    const ctx = ctxOf({ memberOrder: ['m1', 'm2', 'm3'], rule: rule([['m1', 4000], ['m2', 3000], ['m3', 3000]]) });
    assert.deepEqual(setPercentText(draftOf(ctx), ctx, 'm1', '50').percents, { m1: '50', m2: '30', m3: '30' });
  });
});

describe('上限額つきにする', () => {
  it('オンにすると、先頭（本人）が上限まで負担する人。超えた分は、本人0%・残りを均等', () => {
    const draft = enableCap(draftOf(), ctxOf());
    assert.equal(draft.capEnabled, true);
    assert.equal(draft.capMemberId, 'm1');
    assert.deepEqual(draft.percents, { m1: '0', m2: '100' });
  });

  it('3人なら、残りの2人を均等', () => {
    const ctx = ctxOf({ memberOrder: ['m1', 'm2', 'm3'], rule: rule([['m1', 4000], ['m2', 3000], ['m3', 3000]]) });
    assert.deepEqual(enableCap(draftOf(ctx), ctx).percents, { m1: '0', m2: '50', m3: '50' });
  });

  it('上限まで負担する人を変えると、新しい人が0%・残りが均等になる', () => {
    const on = enableCap(draftOf(), ctxOf());
    const changed = setCapMember(on, ctxOf(), 'm2');
    assert.equal(changed.capMemberId, 'm2');
    assert.deepEqual(changed.percents, { m1: '100', m2: '0' });
  });

  it('1人だけのグループは、その人が全部', () => {
    const ctx = ctxOf({ memberOrder: ['m1'], rule: rule([['m1', 10000]]) });
    assert.deepEqual(enableCap(draftOf(ctx), ctx).percents, { m1: '100' });
  });

  it('オンにし直しても、すでに選んだ人を保つ', () => {
    const draft = { ...draftOf(), capMemberId: 'm2' };
    assert.equal(enableCap(draft, ctxOf()).capMemberId, 'm2');
  });
});

describe('checkDraft', () => {
  it('名前は、前後の空白を落とす。空・21文字以上は断る（コードポイントで数える）', () => {
    const ctx = ctxOf();
    const draft = draftOf(ctx);
    assert.deepEqual(checkDraft({ ...draft, name: '  外食  ' }, ctx), {
      ok: true,
      name: '外食',
      shares: [{ memberId: 'm1', basisPoints: 7000 }, { memberId: 'm2', basisPoints: 3000 }],
      cap: null,
    });
    assert.deepEqual(checkDraft({ ...draft, name: '   ' }, ctx), { ok: false, message: '名前を入力してください。' });
    assert.equal(checkDraft({ ...draft, name: '😀'.repeat(MAX_CATEGORY_NAME_LENGTH) }, ctx).ok, true);
    assert.deepEqual(checkDraft({ ...draft, name: '😀'.repeat(MAX_CATEGORY_NAME_LENGTH + 1) }, ctx), {
      ok: false,
      message: `名前は${MAX_CATEGORY_NAME_LENGTH}文字までです。`,
    });
  });

  it('割合を編集できないとき（作る前の月・締めた月・新規）は、名前だけを見る', () => {
    for (const ctx of [ctxOf({ rule: null }), ctxOf({ shareEditable: false }), ctxOf({ editing: null })]) {
      assert.equal(canEditShares(ctx), false);
      // 割合の欄が壊れていても、名前だけを見るので通る
      const check = checkDraft({ ...draftOf(), percents: { m1: 'x' } }, ctx);
      assert.deepEqual(check, { ok: true, name: '家賃', shares: null, cap: null });
    }
  });

  it('合計が100%でなければ、差を添えて断る。形が違う・100%超の欄も断る', () => {
    const ctx = ctxOf();
    const draft = draftOf(ctx);
    assert.deepEqual(checkDraft({ ...draft, percents: { m1: '60', m2: '30' } }, ctx), {
      ok: false,
      message: '合計が100%になるように入力してください（いま 90%）。',
    });
    for (const text of ['x', '101', '1.234', '-5']) {
      assert.deepEqual(checkDraft({ ...draft, percents: { m1: text, m2: '0' } }, ctx), {
        ok: false,
        message: '割合は、0〜100の数字で入力してください。',
      });
    }
    // 空の欄は0%として読む
    assert.equal(checkDraft({ ...draft, percents: { m1: '100', m2: '' } }, ctx).ok, true);
  });

  it('0.01%の端数を含む割合も通す（均等にリセットした割合）', () => {
    const ctx = ctxOf({ memberOrder: ['m1', 'm2', 'm3'], rule: rule([['m1', 3334], ['m2', 3333], ['m3', 3333]]) });
    const check = checkDraft(draftOf(ctx), ctx);
    assert.deepEqual(check.ok && check.shares, [
      { memberId: 'm1', basisPoints: 3334 },
      { memberId: 'm2', basisPoints: 3333 },
      { memberId: 'm3', basisPoints: 3333 },
    ]);
  });

  it('上限額つきは、上限まで負担する人と、1以上の金額が要る', () => {
    const ctx = ctxOf();
    const on = { ...enableCap(draftOf(ctx), ctx), capAmount: '10000' };
    assert.deepEqual(checkDraft(on, ctx), {
      ok: true,
      name: '家賃',
      shares: [{ memberId: 'm1', basisPoints: 0 }, { memberId: 'm2', basisPoints: 10000 }],
      cap: { memberId: 'm1', capMinor: 10000 },
    });
    assert.deepEqual(checkDraft({ ...on, capMemberId: null }, ctx), { ok: false, message: '上限まで負担する人を選んでください。' });
    assert.deepEqual(checkDraft({ ...on, capMemberId: 'zz' }, ctx), { ok: false, message: '上限まで負担する人を選んでください。' });
    assert.deepEqual(checkDraft({ ...on, capAmount: '' }, ctx), { ok: false, message: '上限額を入力してください。' });
    assert.deepEqual(checkDraft({ ...on, capAmount: '0' }, ctx), { ok: false, message: '上限額は、0より大きい金額で入力してください。' });
    // 式（電卓の入力）も、評価して金額にする。末尾の演算子は、無いものとして扱う
    assert.deepEqual(checkOk(checkDraft({ ...on, capAmount: '8000+2000' }, ctx)).cap, { memberId: 'm1', capMinor: 10000 });
    assert.deepEqual(checkOk(checkDraft({ ...on, capAmount: '1+' }, ctx)).cap, { memberId: 'm1', capMinor: 1 });
    assert.deepEqual(checkDraft({ ...on, capAmount: '9999999999999' }, ctx), { ok: false, message: '上限額が大きすぎます。' });
  });

  it('上限額は、通貨の最小単位にする（USDは小数2桁）', () => {
    const ctx = ctxOf({ minorUnit: 2, currencyCode: 'USD' });
    const on = { ...enableCap(draftOf(ctx), ctx), capAmount: '12.34' };
    const check = checkDraft(on, ctx);
    assert.deepEqual(check.ok && check.cap, { memberId: 'm1', capMinor: 1234 });
  });
});

function checkOk(check: ReturnType<typeof checkDraft>): Extract<ReturnType<typeof checkDraft>, { ok: true }> {
  assert.ok(check.ok);
  return check;
}

describe('buildSavePlan', () => {
  it('何も変えていなければ、何も送らない', () => {
    const ctx = ctxOf();
    const plan = buildSavePlan(checkOk(checkDraft(draftOf(ctx), ctx)), draftOf(ctx), ctx);
    assert.deepEqual(plan, { profile: null, shares: null });
    assert.equal(hasChanges(plan), false);
  });

  it('名前・アイコン・色は、変えたものだけを送る', () => {
    const ctx = ctxOf();
    const draft = { ...draftOf(ctx), name: ' 住居費 ', color: 'red' };
    const plan = buildSavePlan(checkOk(checkDraft(draft, ctx)), draft, ctx);
    assert.deepEqual(plan, { profile: { name: '住居費', color: 'red' }, shares: null });
    assert.equal(hasChanges(plan), true);
  });

  it('割合を変えたら、全員の割合を送る。上限なしなら通貨は送らない', () => {
    const ctx = ctxOf();
    const draft = applyPreset(draftOf(ctx), ctx, 5000);
    const plan = buildSavePlan(checkOk(checkDraft(draft, ctx)), draft, ctx);
    assert.deepEqual(plan, {
      profile: null,
      shares: {
        shares: [{ memberId: 'm1', basisPoints: 5000 }, { memberId: 'm2', basisPoints: 5000 }],
        cap: null,
        currencyCode: null,
      },
    });
  });

  it('上限額を付けたら、cap と通貨を送る。上限額だけを変えても送る。外したら cap は null', () => {
    const ctx = ctxOf({ currencyCode: 'JPY' });
    const on = { ...enableCap(draftOf(ctx), ctx), capAmount: '10000' };
    const plan = buildSavePlan(checkOk(checkDraft(on, ctx)), on, ctx);
    assert.deepEqual(plan.shares, {
      shares: [{ memberId: 'm1', basisPoints: 0 }, { memberId: 'm2', basisPoints: 10000 }],
      cap: { memberId: 'm1', capMinor: 10000 },
      currencyCode: 'JPY',
    });

    // すでに上限額つきの費目: 上限額だけを変える / 外す / 変えない
    const cappedRule = rule([['m1', 0], ['m2', 10000]], { memberId: 'm1', capMinor: 10000 });
    const cappedCtx = ctxOf({ rule: cappedRule });
    const same = draftOf(cappedCtx);
    assert.equal(buildSavePlan(checkOk(checkDraft(same, cappedCtx)), same, cappedCtx).shares, null);
    const amountChanged = { ...same, capAmount: '20000' };
    assert.equal(buildSavePlan(checkOk(checkDraft(amountChanged, cappedCtx)), amountChanged, cappedCtx).shares?.cap?.capMinor, 20000);
    const removed = { ...same, capEnabled: false };
    const removedPlan = buildSavePlan(checkOk(checkDraft(removed, cappedCtx)), removed, cappedCtx);
    assert.deepEqual(removedPlan.shares, {
      shares: [{ memberId: 'm1', basisPoints: 0 }, { memberId: 'm2', basisPoints: 10000 }],
      cap: null,
      currencyCode: null,
    });
  });

  it('割合を編集できないときは、割合を送らない（名前だけ）', () => {
    const ctx = ctxOf({ shareEditable: false });
    const draft = { ...draftOf(ctx), name: '住居費' };
    assert.deepEqual(buildSavePlan(checkOk(checkDraft(draft, ctx)), draft, ctx), { profile: { name: '住居費' }, shares: null });
  });
});

describe('buildCreateInput', () => {
  it('名前（前後の空白を落とす）・アイコン・色だけ。割合は、サーバーが均等で作る', () => {
    const ctx = ctxOf({ editing: null, rule: null });
    const draft: CategoryDraft = { ...newDraft([]), name: ' 美容 ', icon: 'scissors', color: 'pink' };
    assert.deepEqual(buildCreateInput(checkOk(checkDraft(draft, ctx)), draft), { name: '美容', icon: 'scissors', color: 'pink' });
  });
});
