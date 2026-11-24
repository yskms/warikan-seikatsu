// 固定費の保存・止める・再開・削除の失敗の文言と、成功のあとの案内のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { RecurringRejectedError } from '../repositories/recurringRepository.ts';
import { saveRecurringErrorMessage, skippedNotice } from './recurringMessage.ts';

const reject = (reason: string, extra: { memberId?: string; status?: number } = {}) =>
  new RecurringRejectedError(extra.status ?? 409, { reason, memberId: extra.memberId ?? null });
const names = (id: string) => (id === 'm2' ? '彼女' : undefined);

describe('saveRecurringErrorMessage（断られたとき）', () => {
  it('競合は、読み直してもう一度。止める・再開・削除は、一覧で状態を確認してもらう', () => {
    assert.equal(saveRecurringErrorMessage(reject('conflict'), 'update'), '他のメンバーが更新しました。もう一度保存してください。');
    assert.equal(saveRecurringErrorMessage(reject('conflict'), 'create'), '他のメンバーが更新しました。もう一度保存してください。');
    for (const action of ['pause', 'resume', 'remove'] as const) {
      assert.match(saveRecurringErrorMessage(reject('conflict'), action), /固定費の一覧で状態を確認/);
    }
  });

  it('使えないメンバーは、支払う人・負担の対象・両方で、直す場所を変える', () => {
    const payer = saveRecurringErrorMessage(reject('member_not_available', { memberId: 'm2' }), 'update', names, { payerMemberId: 'm2' });
    assert.equal(payer, '彼女さんは、支払う人にできません。支払う人を選び直してください。');
    const split = saveRecurringErrorMessage(reject('member_not_available', { memberId: 'm2' }), 'resume', names, {
      payerMemberId: 'm1',
      splitMemberIds: ['m1', 'm2'],
    });
    assert.equal(split, '彼女さんは負担の対象にできません。負担の分け方を変えてください。');
    const both = saveRecurringErrorMessage(reject('member_not_available', { memberId: 'm2' }), 'create', names, {
      payerMemberId: 'm2',
      splitMemberIds: ['m2'],
    });
    assert.match(both, /支払う人にも負担の対象にもできません/);
    // 名前が引けない
    assert.equal(
      saveRecurringErrorMessage(reject('member_not_available', { memberId: 'zz' }), 'update', names, { payerMemberId: 'zz' }),
      '使えないメンバーは、支払う人にできません。支払う人を選び直してください。',
    );
    assert.match(saveRecurringErrorMessage(reject('member_not_available'), 'update'), /使えないメンバーが含まれています/);
  });

  it('使わない設定のカテゴリ・通貨の変更・上限・作った固定費の削除・すでに無い・権限', () => {
    assert.match(saveRecurringErrorMessage(reject('category_not_available'), 'resume'), /使わない設定/);
    assert.match(saveRecurringErrorMessage(reject('currency_mismatch'), 'update'), /通貨が変わりました/);
    assert.match(saveRecurringErrorMessage(reject('too_many_recurring_expenses'), 'create'), /上限/);
    assert.match(saveRecurringErrorMessage(reject('recurring_expense_in_use'), 'remove'), /止める/);
    assert.match(saveRecurringErrorMessage(reject('not_found', { status: 404 }), 'remove'), /すでに削除されています/);
    assert.match(saveRecurringErrorMessage(reject('not_found', { status: 404 }), 'update'), /すでに削除されたか/);
    assert.match(saveRecurringErrorMessage(reject('forbidden', { status: 403 }), 'update'), /登録・変更できません/);
  });

  it('知らない理由・400は、アプリの更新を案内する。操作ごとに言い方を変える', () => {
    assert.equal(
      saveRecurringErrorMessage(new RecurringRejectedError(400, { reason: 'invalid_request', field: 'split' }), 'update'),
      '保存できませんでした。アプリを最新の版に更新して、お試しください。',
    );
    assert.match(saveRecurringErrorMessage(reject('something_new'), 'remove'), /^削除できませんでした/);
    assert.match(saveRecurringErrorMessage(reject('something_new'), 'pause'), /^止める操作できませんでした/);
    assert.match(saveRecurringErrorMessage(reject('something_new'), 'resume'), /^再開できませんでした/);
  });
});

describe('saveRecurringErrorMessage（通信などの失敗）', () => {
  it('通信できない・混み合っている・ログイン・保存先を読めない', () => {
    assert.match(saveRecurringErrorMessage(new AuthError('network'), 'create'), /通信できませんでした。入力内容はそのまま/);
    assert.match(saveRecurringErrorMessage(new AuthError('unavailable'), 'update'), /混み合っています/);
    assert.match(saveRecurringErrorMessage(new AuthError('unauthorized'), 'update'), /ログインを確認できませんでした/);
    assert.match(saveRecurringErrorMessage(new AuthError('not-signed-in'), 'update'), /ログインを確認できませんでした/);
    assert.match(saveRecurringErrorMessage(new AuthError('storage-failed'), 'update'), /ログイン情報を読み取れません/);
    assert.match(saveRecurringErrorMessage(new AuthError('invalid-request'), 'update'), /アプリを最新の版/);
  });

  it('応答が読めないときは、やり直しても二重にならないと伝える', () => {
    assert.match(saveRecurringErrorMessage(new AuthError('invalid-response'), 'create'), /もう一度保存しても、二重にはなりません/);
    assert.match(saveRecurringErrorMessage(new AuthError('invalid-response'), 'remove'), /もう一度削除しても/);
    assert.match(saveRecurringErrorMessage(new AuthError('invalid-response'), 'pause'), /もう一度操作しても/);
  });

  it('それ以外は、時間をおいて', () => {
    assert.match(saveRecurringErrorMessage(new Error('x'), 'update'), /時間をおいて/);
    assert.match(saveRecurringErrorMessage('x', 'remove'), /^削除できませんでした。時間をおいて/);
  });
});

describe('skippedNotice', () => {
  const skipped = { id: 'r1', thisMonthSkipped: true };
  const notSkipped = { id: 'r1', thisMonthSkipped: false };

  it('今月の分を作らない記録が無ければ、出さない', () => {
    assert.equal(skippedNotice('create', notSkipped), null);
    assert.equal(skippedNotice({ paused: false }, notSkipped), null);
  });

  it('登録・再開・日や開始月を変えたあとは、出す', () => {
    const expected = { title: '今月の分は作られません', body: '必要なら、支出を直接登録してください。' };
    assert.deepEqual(skippedNotice('create', skipped), expected);
    assert.deepEqual(skippedNotice({ paused: false }, skipped), expected);
    assert.deepEqual(skippedNotice({ dayOfMonth: 3 }, skipped), expected);
    assert.deepEqual(skippedNotice({ startMonth: '2026-12' }, skipped), expected);
  });

  it('内容や金額を直しただけのとき・止めたときは、出さない', () => {
    assert.equal(skippedNotice({ amountMinor: 1, currencyCode: 'JPY' }, skipped), null);
    assert.equal(skippedNotice({ description: 'x' }, skipped), null);
    assert.equal(skippedNotice({ paused: true }, skipped), null);
    assert.equal(skippedNotice({ endMonth: null }, skipped), null);
  });
});
