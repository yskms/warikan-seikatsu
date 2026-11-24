// 月締め・精算完了・繰越の失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { SettlementRejectedError } from '../repositories/settlementRepository.ts';
import {
  GROUP_DELETED_MESSAGE,
  settlementErrorMessage,
  shouldReloadAfter,
  withReloadFailure,
  type SettlementAction,
} from './settlementMessage.ts';

const rejected = (reason: string | null, extra: ConstructorParameters<typeof SettlementRejectedError>[1] = {}) =>
  new SettlementRejectedError(409, { reason, ...extra });

const ACTIONS: SettlementAction[] = ['close', 'settle', 'carry'];
const DASHES = /[—―⸺⸻]/;

describe('settlementErrorMessage', () => {
  it('競合は、内容が変わったことと、もう一度の案内。誰かの操作とも、読み直せたとも言わない', () => {
    for (const action of ACTIONS) {
      const text = settlementErrorMessage(rejected('conflict'), action);
      assert.ok(!text.includes('他のメンバー'), action);
      assert.ok(!text.includes('読み直し'), action);
    }
    assert.equal(
      settlementErrorMessage(rejected('conflict'), 'close'),
      '内容が変わりました。確認してから、もう一度締めてください。',
    );
    assert.equal(
      settlementErrorMessage(rejected('conflict'), 'settle'),
      '内容が変わりました。画面を確認して、もう一度お試しください。',
    );
  });

  it('月締めが断られた理由ごとの文言。先に済ませる月が無くても、文が崩れない', () => {
    assert.equal(settlementErrorMessage(rejected('month_closed'), 'close'), 'この月は、すでに締められています。');
    assert.equal(
      settlementErrorMessage(rejected('previous_month_not_closed', { month: '2026-10' }), 'close'),
      '先に10月を締めてください。',
    );
    assert.equal(
      settlementErrorMessage(rejected('previous_month_unsettled', { month: '2026-10' }), 'close'),
      '先に10月分の精算を済ませてください。',
    );
    assert.equal(
      settlementErrorMessage(rejected('previous_month_not_closed'), 'close'),
      '先に前の月を締めてください。',
    );
    assert.match(settlementErrorMessage(rejected('month_skipped'), 'close'), /締められません/);
    assert.match(settlementErrorMessage(rejected('month_not_started'), 'close'), /まだ始まっていません/);
    assert.match(settlementErrorMessage(rejected('forbidden'), 'close'), /締められる月ではありません/);
  });

  it('すでに処理済みの送金は、いまの状態を添える', () => {
    const message = (status: string | null) =>
      settlementErrorMessage(rejected('transfer_not_pending', { transferStatus: status }), 'settle');
    assert.equal(message('settled'), 'この送金は、すでに精算済みです。');
    assert.equal(message('carried'), 'この送金は、すでに繰り越されています。');
    assert.equal(message(null), 'この送金は、すでに処理されています。');
    assert.equal(message('unexpected-value'), 'この送金は、すでに処理されています。');
  });

  it('繰り越せない送金は、精算済みにするよう案内する（削除されたユーザーが関わる場合も含めて言う）', () => {
    const text = settlementErrorMessage(rejected('transfer_not_carryable'), 'carry');
    assert.match(text, /繰り越せません。精算済みにしてください/);
    assert.match(text, /脱退するメンバーや削除されたユーザー/);
  });

  it('理由が分からない断り（400 など）は、操作の名前を添えて、アプリの更新を案内する', () => {
    assert.equal(
      settlementErrorMessage(new SettlementRejectedError(400, { reason: 'invalid_request' }), 'close'),
      '締められませんでした。アプリを最新の版に更新して、お試しください。',
    );
    assert.equal(
      settlementErrorMessage(rejected(null), 'settle'),
      '精算済みにできませんでした。アプリを最新の版に更新して、お試しください。',
    );
    assert.equal(
      settlementErrorMessage(rejected('something_new'), 'carry'),
      '繰り越せませんでした。アプリを最新の版に更新して、お試しください。',
    );
  });

  it('通信の失敗は、済んでいるかもしれないので、ホームでの確認を案内する', () => {
    assert.match(settlementErrorMessage(new AuthError('network'), 'close'), /締められたかは、ホームで確認してください/);
    assert.match(settlementErrorMessage(new AuthError('network'), 'settle'), /処理されたかは、ホームで確認してください/);
    assert.match(settlementErrorMessage(new AuthError('unavailable'), 'carry'), /ホームで確認してください/);
    assert.match(settlementErrorMessage(new AuthError('invalid-response'), 'close'), /二重にはなりません/);
  });

  it('セッション・保存先の失敗と、想定外の失敗', () => {
    assert.match(settlementErrorMessage(new AuthError('unauthorized'), 'close'), /もう一度ログイン/);
    assert.match(settlementErrorMessage(new AuthError('not-signed-in'), 'settle'), /もう一度ログイン/);
    assert.match(settlementErrorMessage(new AuthError('storage-failed'), 'carry'), /ロックを解除/);
    assert.match(settlementErrorMessage(new AuthError('invalid-request'), 'close'), /最新の版に更新/);
    assert.match(settlementErrorMessage(new Error('x'), 'settle'), /精算済みにできませんでした。時間をおいて/);
  });

  it('確認の申告が無いまま、グループが消えることになった（delete_not_acknowledged）ときは、確認し直す案内で、読み直す', () => {
    const error = rejected('delete_not_acknowledged');
    assert.match(settlementErrorMessage(error, 'close'), /グループのデータがすべて削除されることになったため、確認し直してください/);
    assert.equal(shouldReloadAfter(error), true);
  });

  it('どの失敗も、空でなく、長いダッシュを含まない', () => {
    const codes: AuthErrorCode[] = ['network', 'unavailable', 'unauthorized', 'invalid-request', 'invalid-response', 'storage-failed', 'unexpected'];
    const reasons = [null, 'conflict', 'month_closed', 'month_skipped', 'month_not_started', 'previous_month_not_closed', 'previous_month_unsettled', 'transfer_not_pending', 'transfer_not_carryable', 'not_found', 'forbidden', 'delete_not_acknowledged'];
    for (const action of ACTIONS) {
      const messages = [
        ...codes.map((code) => settlementErrorMessage(new AuthError(code), action)),
        ...reasons.map((reason) => settlementErrorMessage(rejected(reason), action)),
      ];
      for (const text of messages) {
        assert.ok(text.length > 0, action);
        assert.ok(!DASHES.test(text), text);
      }
    }
    assert.ok(!DASHES.test(GROUP_DELETED_MESSAGE));
  });
});

describe('withReloadFailure', () => {
  it('断られた理由を捨てず、読み込みの失敗の文言と、空行を挟んで並べる', () => {
    assert.equal(
      withReloadFailure('先に10月分の精算を済ませてください。', 'データを読み込めませんでした。'),
      '先に10月分の精算を済ませてください。\n\nデータを読み込めませんでした。',
    );
  });
});

describe('shouldReloadAfter', () => {
  it('サーバーが断ったときだけ読み直す（通信の失敗では、読み直さない）', () => {
    assert.equal(shouldReloadAfter(rejected('conflict')), true);
    assert.equal(shouldReloadAfter(rejected(null)), true);
    assert.equal(shouldReloadAfter(new AuthError('network')), false);
    assert.equal(shouldReloadAfter(new AuthError('unavailable')), false);
    assert.equal(shouldReloadAfter(new AuthError('invalid-response')), false);
    assert.equal(shouldReloadAfter(new Error('x')), false);
  });
});
