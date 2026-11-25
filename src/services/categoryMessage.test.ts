// カテゴリと負担割合の操作の失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { CategoryRejectedError } from '../repositories/categoryRepository.ts';
import {
  categoryErrorMessage,
  isCreateConflict,
  resultUnknown,
  reorderFailureOutcome,
  shouldReloadAfter,
  staleReorderMessage,
  unsavedChangesNote,
} from './categoryMessage.ts';

const rejected = (reason: string | null, detail: ConstructorParameters<typeof CategoryRejectedError>[1] = {}, status = 409) =>
  new CategoryRejectedError(status, { reason, ...detail });

describe('shouldReloadAfter', () => {
  it('編集で、他のメンバーの操作で古くなったとき（競合・メンバーや費目の増減・月が締まった）は読み直す', () => {
    for (const reason of ['conflict', 'members_changed', 'categories_changed', 'month_closed']) {
      for (const action of ['save-share', 'update'] as const) {
        assert.equal(shouldReloadAfter(rejected(reason), action), true, `${reason}/${action}`);
      }
    }
  });

  it('並べ替えは、費目が変わった（categories_changed）ときだけ読み直す。競合（conflict）では、作った並びを捨てない', () => {
    assert.equal(shouldReloadAfter(rejected('categories_changed'), 'reorder'), true);
    for (const reason of ['conflict', 'members_changed', 'month_closed', 'forbidden', 'not_found', null]) {
      assert.equal(shouldReloadAfter(rejected(reason), 'reorder'), false, String(reason));
    }
    assert.equal(shouldReloadAfter(new AuthError('network'), 'reorder'), false);
  });

  it('入力・権限・範囲外などは、読み直しても同じなので読み直さない。通信の失敗も、読み直さない', () => {
    for (const reason of ['month_not_editable', 'too_many_categories', 'currency_mismatch', 'forbidden', 'not_found', null]) {
      assert.equal(shouldReloadAfter(rejected(reason), 'save-share'), false, String(reason));
    }
    assert.equal(shouldReloadAfter(new AuthError('network'), 'update'), false);
    assert.equal(shouldReloadAfter(new Error('x'), 'update'), false);
  });

  it('追加は、どの理由でも読み直さない（読み直すと、入力した名前・アイコン・色が消える）', () => {
    for (const reason of ['conflict', 'members_changed', 'categories_changed', 'month_closed', 'too_many_categories']) {
      assert.equal(shouldReloadAfter(rejected(reason), 'create'), false, reason);
      // 作成が済んだあとの反映も、同じ（読み直すと、追加のシートの入力が消える）
      assert.equal(shouldReloadAfter(rejected(reason), 'create-update'), false, reason);
    }
  });
});

describe('isCreateConflict', () => {
  it('409 conflict だけ（この id を他のグループが使っている、または書き込みの競合が続いた。どちらも作られていない）', () => {
    assert.equal(isCreateConflict(rejected('conflict')), true);
    assert.equal(isCreateConflict(rejected('too_many_categories')), false);
    assert.equal(isCreateConflict(rejected(null, {}, 400)), false);
    assert.equal(isCreateConflict(new AuthError('network')), false);
  });
});

describe('resultUnknown', () => {
  it('サーバーが断ったときは、済んでいない（false）。通信の失敗・応答が読めない・混雑・知らない失敗は、済んだか分からない（true）', () => {
    assert.equal(resultUnknown(rejected('too_many_categories')), false);
    assert.equal(resultUnknown(rejected(null, {}, 400)), false);
    for (const code of ['network', 'invalid-response', 'unavailable'] as const) {
      assert.equal(resultUnknown(new AuthError(code)), true, code);
    }
    assert.equal(resultUnknown(new Error('x')), true);
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
    assert.match(categoryErrorMessage(rejected('conflict'), 'update'), /重なりました/);
  });

  it('追加の競合は、他の操作との競合ではないので、重なったとは言わない（入力は残っていて、もう一度押せばよい）', () => {
    assert.equal(categoryErrorMessage(rejected('conflict'), 'create'), 'カテゴリを追加できませんでした。もう一度お試しください。');
  });

  it('追加で、作成は済んだあとの反映の失敗は、「追加できませんでした」と言わない（カテゴリは作られている）', () => {
    assert.equal(
      categoryErrorMessage(rejected('conflict'), 'create-update'),
      'カテゴリは追加できましたが、入力した内容を反映できませんでした。もう一度お試しください。',
    );
    assert.match(categoryErrorMessage(new AuthError('network'), 'create-update'), /通信できませんでした/);
    assert.match(categoryErrorMessage(rejected('not_found', {}, 404), 'create-update'), /確認できませんでした/);
    assert.match(categoryErrorMessage(rejected('invalid_request', {}, 400), 'create-update'), /^カテゴリは追加できましたが/);
    assert.doesNotMatch(categoryErrorMessage(new AuthError('network'), 'create-update'), /追加できませんでした/);
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

describe('categoryErrorMessage（追加で、作成が済んだあとの失敗）', () => {
  const LEAD = 'カテゴリは追加できましたが、入力した内容を反映できませんでした。';

  it('どの失敗でも、文の頭で、カテゴリは追加できたことを伝える', () => {
    const errors = [
      new AuthError('network'),
      new AuthError('unavailable'),
      new AuthError('invalid-response'),
      new AuthError('invalid-request'),
      new AuthError('unauthorized'),
      new AuthError('storage-failed'),
      new Error('x'),
      rejected('conflict'),
      rejected('not_found', {}, 404),
      rejected('forbidden', {}, 403),
      rejected('invalid_request', {}, 400),
      rejected(null, {}, 400),
    ];
    for (const error of errors) {
      assert.ok(categoryErrorMessage(error, 'create-update').startsWith(LEAD), String(error));
    }
  });

  it('頭の文言を重ねない（すでに頭にある失敗）。通信の失敗は、頭のあとに、通常の案内が続く', () => {
    assert.equal(categoryErrorMessage(rejected('conflict'), 'create-update'), `${LEAD}もう一度お試しください。`);
    assert.equal(
      categoryErrorMessage(new AuthError('network'), 'create-update'),
      `${LEAD}通信できませんでした。電波のよいところで、もう一度お試しください。`,
    );
    for (const error of [new AuthError('invalid-request'), new Error('x'), rejected(null, {}, 400)]) {
      const message = categoryErrorMessage(error, 'create-update');
      assert.equal(message.split(LEAD).length, 2, message);
    }
  });

  it('ほかの操作の文言は、頭を足さない', () => {
    for (const action of ['create', 'update', 'save-share', 'reorder'] as const) {
      assert.ok(!categoryErrorMessage(new AuthError('network'), action).startsWith(LEAD), action);
    }
  });
});

describe('reorderFailureOutcome', () => {
  it('費目が変わったときは、並べ替えをやめて読み直す', () => {
    assert.equal(reorderFailureOutcome(rejected('categories_changed')), 'reload');
  });

  it('脱退が確定している・見つからないときは、並べ替えをやめる（送り直しても通らない。読み直しても同じ）', () => {
    assert.equal(reorderFailureOutcome(rejected('forbidden', {}, 403)), 'exit');
    assert.equal(reorderFailureOutcome(rejected('not_found', {}, 404)), 'exit');
  });

  it('競合・通信の失敗・応答が読めない・知らない失敗は、並びを残して押し直してもらう', () => {
    assert.equal(reorderFailureOutcome(rejected('conflict')), 'keep');
    assert.equal(reorderFailureOutcome(rejected(null, {}, 400)), 'keep');
    assert.equal(reorderFailureOutcome(rejected('something_new')), 'keep');
    for (const code of ['network', 'unavailable', 'invalid-response', 'invalid-request'] as const) {
      assert.equal(reorderFailureOutcome(new AuthError(code)), 'keep', code);
    }
    assert.equal(reorderFailureOutcome(new Error('x')), 'keep');
  });
});

describe('categoryErrorMessage（並べ替えの競合）', () => {
  it('並びは残っているので、「読み直しました」とは言わず、もう一度押してもらう（ほかの操作の競合は、読み直す）', () => {
    assert.equal(categoryErrorMessage(rejected('conflict'), 'reorder'), '他の操作と重なりました。もう一度お試しください。');
    assert.match(categoryErrorMessage(rejected('conflict'), 'update'), /画面を読み直しました/);
    assert.match(categoryErrorMessage(rejected('conflict'), 'save-share'), /画面を読み直しました/);
  });
});

describe('staleReorderMessage', () => {
  it('サーバーが費目の食い違い（categories_changed）で断ったときと同じ文言', () => {
    assert.equal(staleReorderMessage(), categoryErrorMessage(rejected('categories_changed'), 'reorder'));
    assert.match(staleReorderMessage(), /カテゴリが変わった/);
  });
});

describe('unsavedChangesNote', () => {
  it('追加が済んでいれば、カテゴリはもうできていて、名前などは追加したときのままと伝える', () => {
    assert.match(unsavedChangesNote({ created: true, profileSaved: false }), /すでに追加されています/);
    assert.match(unsavedChangesNote({ created: true, profileSaved: false }), /追加したときの内容のまま/);
  });

  it('名前などが保存済みなら、それは残ると伝える。どちらでもなければ、保存されないとだけ', () => {
    assert.match(unsavedChangesNote({ created: false, profileSaved: true }), /先に保存した名前・アイコン・色は、そのまま残ります/);
    assert.equal(unsavedChangesNote({ created: false, profileSaved: false }), '入力した変更は保存されません。');
  });
});
