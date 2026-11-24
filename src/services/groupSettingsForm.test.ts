// グループの設定の入力の検査と、保存の組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import {
  applySaved,
  checkSettings,
  contextOf,
  isDirty,
  rebase,
  type GroupSettingsContext,
  type GroupSettingsDraft,
} from './groupSettingsForm.ts';

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'm1',
    displayName: 'あなた',
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-11',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
    isMe: true,
    ...overrides,
  };
}

function groupOf(overrides: Partial<GroupDetail> = {}, me: Partial<GroupMember> = {}): GroupDetail {
  return {
    id: 'g1',
    name: 'ふたりの生活費',
    currencyCode: 'JPY',
    currencyMinorUnit: 0,
    timezone: 'Asia/Tokyo',
    createdAt: 1790000000000,
    memberId: 'm1',
    currencyLocked: false,
    leaveDeletesGroup: false,
    seatedMembers: 2,
    maxMembers: 5,
    canInvite: true,
    members: [member(me), member({ id: 'm2', displayName: 'パートナー', color: 'blue', isMe: false })],
    ...overrides,
  };
}

function context(overrides: Partial<GroupDetail> = {}, me: Partial<GroupMember> = {}): GroupSettingsContext {
  const result = contextOf(groupOf(overrides, me));
  assert.ok(result);
  return result;
}

describe('contextOf', () => {
  it('グループ名・通貨・自分の表示名・色を、入力の初期値にする。自分は memberId で見つける（isMe ではなく）', () => {
    assert.deepEqual(context().baseline, { name: 'ふたりの生活費', displayName: 'あなた', color: 'pink', currencyCode: 'JPY' });
    const swapped = contextOf(
      groupOf({ memberId: 'm2' }, { isMe: true }),
    );
    assert.equal(swapped?.baseline.displayName, 'パートナー');
  });

  it('自分のメンバーが見つからなければ null', () => {
    assert.equal(contextOf(groupOf({ memberId: 'nobody' })), null);
  });

  it('変えられるものは、サーバーの値（leaveEffective・currencyLocked）で決める', () => {
    assert.deepEqual(context().access, { canEditGroup: true, canEditCurrency: true, currencyLocked: false });
    assert.deepEqual(context({ currencyLocked: true }).access, { canEditGroup: true, canEditCurrency: false, currencyLocked: true });
    // 脱退が確定した人は、グループ名・通貨を変えられない（自分の表示名・色は変えられる）。status は見ない
    assert.deepEqual(context({}, { leaveEffective: true }).access, { canEditGroup: false, canEditCurrency: false, currencyLocked: false });
    assert.equal(context({}, { status: 'unknown' }).access.canEditGroup, true);
  });
});

describe('checkSettings', () => {
  const base = context();
  const same = base.baseline;

  it('変えていなければ、送るものは無い', () => {
    assert.deepEqual(checkSettings(same, base), { ok: true, plan: { group: null, me: null } });
    // 空白だけの違いは、変えたことにしない
    assert.deepEqual(checkSettings({ ...same, name: ` ${same.name} `, displayName: `${same.displayName}　` }, base), {
      ok: true,
      plan: { group: null, me: null },
    });
  });

  it('変えたものだけを送る。グループ名・通貨と、自分の表示名・色は、別の呼び出し', () => {
    assert.deepEqual(checkSettings({ ...same, name: '新しい名前' }, base), {
      ok: true,
      plan: { group: { name: '新しい名前' }, me: null },
    });
    assert.deepEqual(checkSettings({ ...same, currencyCode: 'USD' }, base), {
      ok: true,
      plan: { group: { currencyCode: 'USD' }, me: null },
    });
    assert.deepEqual(checkSettings({ ...same, displayName: 'ゆうき' }, base), {
      ok: true,
      plan: { group: null, me: { displayName: 'ゆうき' } },
    });
    assert.deepEqual(checkSettings({ ...same, color: 'blue' }, base), {
      ok: true,
      plan: { group: null, me: { color: 'blue' } },
    });
    assert.deepEqual(checkSettings({ name: '  新  ', displayName: ' ゆ ', color: 'green', currencyCode: 'EUR' }, base), {
      ok: true,
      plan: { group: { name: '新', currencyCode: 'EUR' }, me: { displayName: 'ゆ', color: 'green' } },
    });
  });

  it('変えた項目だけを検べる。触っていない項目は、読み込んだ値が規則に合わなくても、保存を止めない', () => {
    const odd = context({ name: 'あ'.repeat(31) }, { displayName: 'あ'.repeat(25) });
    assert.deepEqual(checkSettings({ ...odd.baseline, color: 'blue' }, odd), { ok: true, plan: { group: null, me: { color: 'blue' } } });
  });

  it('空・長すぎ・使えない文字は、項目ごとのエラー。通る項目があっても、送らない', () => {
    const result = checkSettings({ ...same, name: '  ', displayName: 'あ'.repeat(21), currencyCode: 'XXX' }, base);
    assert.ok(!result.ok);
    assert.ok(result.errors.name);
    assert.ok(result.errors.displayName?.includes('20'));
    assert.ok(result.errors.currencyCode);
    assert.ok(!checkSettings({ ...same, displayName: 'あ\nい' }, base).ok);
  });

  it('色は、一覧のキーだけを送る（知らないキーは送らない）。知らない色のまま、変えなければ、何も送らない', () => {
    assert.deepEqual(checkSettings({ ...same, color: 'rainbow' }, base), { ok: true, plan: { group: null, me: null } });
    const unknown = context({}, { color: 'rainbow' });
    assert.deepEqual(checkSettings(unknown.baseline, unknown), { ok: true, plan: { group: null, me: null } });
  });

  it('変えられないもの（脱退が確定した人のグループ名・通貨、固定された通貨）は、入力が変わっていても送らない', () => {
    const left = context({}, { leaveEffective: true });
    assert.deepEqual(
      checkSettings({ name: '別の名前', currencyCode: 'USD', displayName: 'ゆうき', color: 'blue' }, left),
      { ok: true, plan: { group: null, me: { displayName: 'ゆうき', color: 'blue' } } },
    );
    const locked = context({ currencyLocked: true });
    assert.deepEqual(checkSettings({ ...locked.baseline, name: '新', currencyCode: 'USD' }, locked), {
      ok: true,
      plan: { group: { name: '新' }, me: null },
    });
  });
});

describe('isDirty', () => {
  const base = context();
  it('変えたか。空白だけの違いは変えたことにしない。変えられないものの入力は数えない', () => {
    assert.equal(isDirty(base.baseline, base), false);
    assert.equal(isDirty({ ...base.baseline, name: ` ${base.baseline.name}　` }, base), false);
    assert.equal(isDirty({ ...base.baseline, name: '新' }, base), true);
    assert.equal(isDirty({ ...base.baseline, color: 'blue' }, base), true);
    assert.equal(isDirty({ ...base.baseline, currencyCode: 'USD' }, base), true);
    const left = context({}, { leaveEffective: true });
    assert.equal(isDirty({ ...left.baseline, name: '新', currencyCode: 'USD' }, left), false);
    assert.equal(isDirty({ ...left.baseline, displayName: '新' }, left), true);
    const locked = context({ currencyLocked: true });
    assert.equal(isDirty({ ...locked.baseline, currencyCode: 'USD' }, locked), false);
  });
});

describe('applySaved', () => {
  const base = context();
  const plan = { group: { name: '新', currencyCode: 'USD' }, me: { displayName: 'ゆ', color: 'blue' } };
  it('済んだ段階だけを、読み込んだ値に取り込む（やり直しで、残りだけを送る）', () => {
    const afterGroup = applySaved(base, plan, 'group');
    assert.deepEqual(afterGroup.baseline, { name: '新', currencyCode: 'USD', displayName: 'あなた', color: 'pink' });
    const draft: GroupSettingsDraft = { name: '新', currencyCode: 'USD', displayName: 'ゆ', color: 'blue' };
    assert.deepEqual(checkSettings(draft, afterGroup), { ok: true, plan: { group: null, me: { displayName: 'ゆ', color: 'blue' } } });
    const afterMe = applySaved(afterGroup, plan, 'me');
    assert.deepEqual(afterMe.baseline, draft);
    assert.equal(isDirty(draft, afterMe), false);
  });

  it('送らなかった側の段階を取り込んでも、何も変わらない', () => {
    assert.deepEqual(applySaved(base, { group: null, me: { color: 'blue' } }, 'group').baseline, base.baseline);
  });
});

describe('rebase', () => {
  const previous = context();
  const edited: GroupSettingsDraft = { name: '自分で直した名前', currencyCode: 'USD', displayName: '自分で直した表示名', color: 'blue' };

  it('触っていない項目は、読み直した値にする（他のメンバーが直した名前を、古い値で出さない）', () => {
    const fresh = context({ name: '他の人が直した名前' });
    assert.deepEqual(rebase(previous.baseline, previous, fresh), fresh.baseline);
  });

  it('触っていて、いまも変えられる項目は、入力を残す', () => {
    const fresh = context({ name: '他の人が直した名前' });
    assert.deepEqual(rebase(edited, previous, fresh), edited);
  });

  it('触っていても、もう変えられない項目（脱退が確定した・通貨が固定された）は、読み直した値にする。自分の表示名・色は残す', () => {
    const left = context({}, { leaveEffective: true });
    assert.deepEqual(rebase(edited, previous, left), {
      name: left.baseline.name,
      currencyCode: left.baseline.currencyCode,
      displayName: edited.displayName,
      color: edited.color,
    });
    const locked = context({ currencyLocked: true });
    assert.deepEqual(rebase(edited, previous, locked), { ...edited, currencyCode: locked.baseline.currencyCode });
  });
});
