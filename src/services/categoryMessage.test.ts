// カテゴリと負担割合の操作の失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { CategoryRejectedError } from '../repositories/categoryRepository.ts';
import { categoryErrorMessage, shouldReloadAfter } from './categoryMessage.ts';

const rejected = (reason: string | null, detail: ConstructorParameters<typeof CategoryRejectedError>[1] = {}, status = 409) =>
  new CategoryRejectedError(status, { reason, ...detail });

describe('shouldReloadAfter', () => {
  it('他のメンバーの操作で古くなったとき（競合・メンバーや費目の増減・月が締まった）は読み直す', () => {
    for (const reason of ['conflict', 'members_changed', 'categories_changed', 'month_closed']) {
      assert.equal(shouldReloadAfter(rejected(reason)), true, reason);
    }
  });

  it('入力・権限・範囲外などは、読み直しても同じなので読み直さない。通信の失敗も、読み直さない', () => {
    for (const reason of ['month_not_editable', 'too_many_categories', 'currency_mismatch', 'forbidden', 'not_found', null]) {
      assert.equal(shouldReloadAfter(rejected(reason)), false, String(reason));
    }
    assert.equal(shouldReloadAfter(new AuthError('network')), false);
    assert.equal(shouldReloadAfter(new Error('x')), false);
  });
});

describe('categoryErrorMessage（断られたとき）', () => {
  it('理由ごとの文言', () => {
    assert.match(categoryErrorMessage(rejected('month_closed'), 'save-share'), /すでに締められています/);
    assert.match(categoryErrorMessage(rejected('members_changed'), 'save-share'), /メンバーが変わった/);
    assert.match(categoryErrorMessage(rejected('categories_changed'), 'reorder'), /カテゴリが変わった/);
    assert.match(categoryErrorMessage(rejected('too_many_categories'), 'create'), /30個まで/);
    assert.match(categoryErrorMessage(rejected('currency_mismatch'), 'save-share'), /通貨が変わっています/);
    assert.match(categoryErrorMessage(rejected('forbidden', {}, 403), 'update'), /脱退が確定/);
    assert.match(categoryErrorMessage(rejected('not_found', {}, 404), 'update'), /確認できませんでした/);
    assert.match(categoryErrorMessage(rejected('conflict'), 'create'), /重なりました/);
  });

  it('直せる月の範囲が分かれば、範囲を案内する。分からなければ範囲なしの文言', () => {
    assert.equal(
      categoryErrorMessage(rejected('month_not_editable', { from: '2026-10', to: '2026-11' }), 'save-share'),
      'この月の割合は変えられません。2026年10月から2026年11月までの間で選んでください。',
    );
    assert.equal(categoryErrorMessage(rejected('month_not_editable'), 'save-share'), 'この月の割合は変えられません。');
  });

  it('知らない理由・理由なし（400など）は、操作ごとに「更新して」と案内する', () => {
    assert.equal(
      categoryErrorMessage(rejected('invalid_request', {}, 400), 'save-share'),
      '割合を保存できませんでした。アプリを最新の版に更新して、お試しください。',
    );
    assert.equal(
      categoryErrorMessage(rejected(null, {}, 400), 'create'),
      'カテゴリを追加できませんでした。アプリを最新の版に更新して、お試しください。',
    );
    assert.match(categoryErrorMessage(rejected('something_new'), 'update'), /カテゴリを変更できませんでした。/);
    assert.match(categoryErrorMessage(rejected('something_new'), 'reorder'), /並べ替えを保存できませんでした。/);
  });
});

describe('categoryErrorMessage（通信など）', () => {
  it('種類ごとの文言', () => {
    assert.match(categoryErrorMessage(new AuthError('network'), 'create'), /通信できませんでした/);
    assert.match(categoryErrorMessage(new AuthError('unavailable'), 'create'), /混み合っています/);
    assert.match(categoryErrorMessage(new AuthError('unauthorized'), 'create'), /ログインを確認できませんでした/);
    assert.match(categoryErrorMessage(new AuthError('not-signed-in'), 'create'), /ログインを確認できませんでした/);
    assert.match(categoryErrorMessage(new AuthError('storage-failed'), 'create'), /ロックを解除/);
    assert.match(categoryErrorMessage(new AuthError('invalid-request'), 'update'), /カテゴリを変更できませんでした。/);
  });

  it('応答が読めないときは、二重にならないことを添える', () => {
    assert.match(categoryErrorMessage(new AuthError('invalid-response'), 'save-share'), /二重にはなりません/);
  });

  it('知らない失敗は、操作ごとの汎用の文言', () => {
    assert.equal(categoryErrorMessage(new Error('x'), 'reorder'), '並べ替えを保存できませんでした。時間をおいて、もう一度お試しください。');
  });
});
