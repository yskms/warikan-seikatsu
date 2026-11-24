// 支出の保存・削除の失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { ExpenseRejectedError } from '../repositories/expenseRepository.ts';
import { saveExpenseErrorMessage } from './expenseMessage.ts';

const rejected = (reason: string | null, extra: ConstructorParameters<typeof ExpenseRejectedError>[1] = {}) =>
  new ExpenseRejectedError(409, { reason, ...extra });

describe('saveExpenseErrorMessage', () => {
  it('競合は「もう一度」。操作の名前（保存・削除）を合わせる', () => {
    assert.equal(saveExpenseErrorMessage(rejected('conflict'), 'create'), '他のメンバーが更新しました。もう一度保存してください。');
    assert.equal(saveExpenseErrorMessage(rejected('conflict'), 'remove'), '他のメンバーが更新しました。もう一度削除してください。');
  });

  it('使えないメンバーは、名前を出す。名前が引けなければ名前なし', () => {
    const error = rejected('member_not_available', { memberId: 'm2' });
    assert.equal(
      saveExpenseErrorMessage(error, 'update', (id) => (id === 'm2' ? '彼女' : undefined)),
      '彼女さんは負担の対象にできません。負担の分け方を変えてください。',
    );
    assert.equal(
      saveExpenseErrorMessage(error, 'update'),
      'この月の支出に使えないメンバーが含まれています。負担の分け方を変えてください。',
    );
    assert.equal(
      saveExpenseErrorMessage(rejected('member_not_available'), 'update', () => '彼女'),
      'この月の支出に使えないメンバーが含まれています。負担の分け方を変えてください。',
    );
  });

  it('使えないメンバーが支払者のときは、支払った人の選び直しを案内する（負担の分け方ではない）', () => {
    const error = rejected('member_not_available', { memberId: 'm2' });
    const name = (id: string) => (id === 'm2' ? '彼女' : undefined);
    assert.equal(
      saveExpenseErrorMessage(error, 'create', name, { payerMemberId: 'm2', splitMemberIds: [] }),
      '彼女さんは、この月の支払った人にできません。支払った人を選び直してください。',
    );
    assert.equal(
      saveExpenseErrorMessage(error, 'create', name, { payerMemberId: 'm2', splitMemberIds: ['m1', 'm2'] }),
      '彼女さんは、この月の支払った人にも負担の対象にもできません。支払った人と負担の分け方を変えてください。',
    );
    // 名前が引けないとき
    assert.equal(
      saveExpenseErrorMessage(error, 'create', () => undefined, { payerMemberId: 'm2' }),
      'この月の支出に使えないメンバーは、この月の支払った人にできません。支払った人を選び直してください。',
    );
    // 支払者でなければ、これまでどおり
    assert.equal(
      saveExpenseErrorMessage(error, 'create', name, { payerMemberId: 'm1', splitMemberIds: ['m2'] }),
      '彼女さんは負担の対象にできません。負担の分け方を変えてください。',
    );
  });

  it('理由ごとの案内', () => {
    assert.match(saveExpenseErrorMessage(rejected('month_closed'), 'update'), /締められた/);
    assert.match(saveExpenseErrorMessage(rejected('month_not_registerable'), 'create'), /登録する月を選び直/);
    assert.match(saveExpenseErrorMessage(rejected('category_not_available'), 'create'), /別の費目/);
    assert.match(saveExpenseErrorMessage(rejected('currency_mismatch'), 'create'), /通貨が変わりました/);
    assert.match(saveExpenseErrorMessage(rejected('not_found'), 'remove'), /すでに削除されています/);
    assert.match(saveExpenseErrorMessage(rejected('not_found'), 'update'), /削除されたか/);
    assert.match(saveExpenseErrorMessage(rejected('forbidden'), 'create'), /登録・変更できません/);
  });

  it('知らない理由・400は、アプリの更新を案内する（時間をおく案内はしない）', () => {
    for (const reason of ['invalid_request', 'something_new', null]) {
      const message = saveExpenseErrorMessage(rejected(reason), 'create');
      assert.match(message, /最新の版に更新/);
      assert.doesNotMatch(message, /時間をおいて/);
    }
  });

  it('通信の失敗は、入力が残っていることを伝える', () => {
    assert.match(saveExpenseErrorMessage(new AuthError('network'), 'create'), /入力内容はそのまま/);
    assert.match(saveExpenseErrorMessage(new AuthError('unavailable'), 'update'), /入力内容はそのまま/);
  });

  it('応答が読めないときは、やり直しても二重にならないと伝える', () => {
    const message = saveExpenseErrorMessage(new AuthError('invalid-response'), 'create');
    assert.match(message, /二重にはなりません/);
    assert.match(saveExpenseErrorMessage(new AuthError('invalid-response'), 'remove'), /もう一度削除しても/);
  });

  it('ログイン・保存先の失敗と、想定外の失敗', () => {
    assert.match(saveExpenseErrorMessage(new AuthError('unauthorized'), 'create'), /もう一度ログイン/);
    assert.match(saveExpenseErrorMessage(new AuthError('storage-failed'), 'create'), /ロックを解除/);
    assert.match(saveExpenseErrorMessage(new Error('x'), 'create'), /時間をおいて/);
    assert.match(saveExpenseErrorMessage('x', 'remove'), /削除できませんでした/);
  });
});
