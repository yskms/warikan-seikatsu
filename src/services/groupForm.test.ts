// グループ作成のフォームの検査のテスト。`npm test` で実行する。規則は、Workerの `parseLabel` と同じ。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateCreateGroupForm, validateDisplayName, validateGroupName } from './groupForm.ts';

const valid = { name: 'ふたりの生活費', displayName: 'あなた', currencyCode: 'JPY' };

describe('validateCreateGroupForm', () => {
  it('通ったときは、前後の空白を落とした値を返す', () => {
    const result = validateCreateGroupForm({ name: '  家計 ', displayName: '　あなた　', currencyCode: 'USD' });
    assert.deepEqual(result, { ok: true, value: { name: '家計', displayName: 'あなた', currencyCode: 'USD' } });
  });

  it('空・空白だけは、グループ名・表示名それぞれのエラー', () => {
    const result = validateCreateGroupForm({ ...valid, name: '   ', displayName: '' });
    assert.ok(!result.ok);
    assert.ok(result.errors.name);
    assert.ok(result.errors.displayName);
    assert.equal(result.errors.currencyCode, undefined);
  });

  it('上限は、コードポイントで数える（30字・20字ちょうどは通り、1字超えると断る）', () => {
    assert.ok(validateCreateGroupForm({ ...valid, name: 'あ'.repeat(30), displayName: 'あ'.repeat(20) }).ok);
    const over = validateCreateGroupForm({ ...valid, name: 'あ'.repeat(31), displayName: 'あ'.repeat(21) });
    assert.ok(!over.ok);
    assert.ok(over.errors.name?.includes('30'));
    assert.ok(over.errors.displayName?.includes('20'));
    // サロゲートペア（1コードポイント）。UTF-16の長さでは40になる
    assert.ok(validateCreateGroupForm({ ...valid, displayName: '😀'.repeat(20) }).ok);
    assert.ok(!validateCreateGroupForm({ ...valid, displayName: '😀'.repeat(21) }).ok);
  });

  it('制御文字（改行・タブ）を含むものは断る', () => {
    for (const text of ['あ\nい', 'あ\tい', 'あ\u0000い', 'あ\u007fい']) {
      assert.ok(!validateCreateGroupForm({ ...valid, name: text }).ok, JSON.stringify(text));
    }
  });

  it('選べない通貨は断る', () => {
    const result = validateCreateGroupForm({ ...valid, currencyCode: 'KWD' });
    assert.ok(!result.ok);
    assert.ok(result.errors.currencyCode);
    assert.ok(!validateCreateGroupForm({ ...valid, currencyCode: 'jpy' }).ok);
  });
});

describe('validateDisplayName（参加でも使う）', () => {
  it('前後の空白を落とした値を返す', () => {
    assert.deepEqual(validateDisplayName('　はなこ '), { ok: true, value: 'はなこ' });
  });

  it('空・空白だけ・長すぎる・制御文字は、エラー', () => {
    for (const text of ['', '   ', 'あ'.repeat(21), 'a\nb']) {
      const result = validateDisplayName(text);
      assert.ok(!result.ok, text);
      assert.ok(result.error);
    }
    assert.deepEqual(validateDisplayName('あ'.repeat(20)), { ok: true, value: 'あ'.repeat(20) });
  });

  it('グループ作成の表示名と、同じ文言・同じ規則', () => {
    const create = validateCreateGroupForm({ name: 'g', displayName: '', currencyCode: 'JPY' });
    const single = validateDisplayName('');
    assert.ok(!create.ok && !single.ok);
    assert.equal(create.errors.displayName, single.error);
  });
});

describe('validateGroupName', () => {
  it('通ったときは、前後の空白を落とした値を返す。作成のフォームと同じ規則（空・30字超・制御文字は断る）', () => {
    assert.deepEqual(validateGroupName('　家計 '), { ok: true, value: '家計' });
    assert.ok(!validateGroupName('  ').ok);
    assert.ok(validateGroupName('あ'.repeat(30)).ok);
    const over = validateGroupName('あ'.repeat(31));
    assert.ok(!over.ok && over.error.includes('30'));
    assert.ok(!validateGroupName('あ\nい').ok);
  });
});
