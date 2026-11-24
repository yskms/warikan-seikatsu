// アカウント削除の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { deletedNotice, deleteAccountFailure } from './deleteAccountMessage.ts';

describe('deleteAccountFailure', () => {
  it('取りやめは、何も出さない', () => {
    assert.deepEqual(deleteAccountFailure(new AuthError('cancelled')), { message: null, signedOut: false });
  });

  it('それ以外のどの失敗にも文言があり、コードの文字列は出さない', () => {
    const codes: AuthErrorCode[] = [
      'network',
      'unavailable',
      'unauthorized',
      'invalid-request',
      'invalid-response',
      'provider-unavailable',
      'provider-failed',
      'timeout',
      'already-signed-in',
      'not-signed-in',
      'reauth-failed',
      'account-mismatch',
      'storage-failed',
      'delete-unconfirmed',
      'unexpected',
    ];
    for (const code of codes) {
      const { message } = deleteAccountFailure(new AuthError(code));
      assert.ok(message !== null && message.length > 0, code);
      assert.ok(!message.includes(code), code);
    }
    assert.ok((deleteAccountFailure(new Error('boom')).message ?? '').length > 0);
  });

  it('ログイン画面へ移るのは、サーバーが認めなかったときと、サインインしていなかったときだけ', () => {
    const signedOut: AuthErrorCode[] = ['unauthorized', 'not-signed-in'];
    const codes: AuthErrorCode[] = [
      'network',
      'unavailable',
      'reauth-failed',
      'account-mismatch',
      'delete-unconfirmed',
      'storage-failed',
      'provider-failed',
      'timeout',
      'unexpected',
      ...signedOut,
    ];
    for (const code of codes) {
      assert.equal(deleteAccountFailure(new AuthError(code)).signedOut, signedOut.includes(code), code);
    }
  });

  it('「削除されていない」と言い切るのは、削除の要求を送る前に終わった失敗だけ', () => {
    for (const code of ['network', 'unavailable', 'reauth-failed', 'account-mismatch', 'provider-failed', 'timeout', 'storage-failed'] as const) {
      assert.match(deleteAccountFailure(new AuthError(code)).message ?? '', /削除されていません/, code);
    }
    // 要求を送ったあとの失敗・サーバーが認めなかった失敗は、削除されたかもしれない
    for (const code of ['delete-unconfirmed', 'unauthorized'] as const) {
      const message = deleteAccountFailure(new AuthError(code)).message ?? '';
      assert.doesNotMatch(message, /削除されていません/, code);
      assert.match(message, /削除されている可能性|削除されたかどうか分かりません/, code);
    }
    // 想定外の失敗は、どちらとも言わない
    assert.doesNotMatch(deleteAccountFailure(new AuthError('unexpected')).message ?? '', /削除されていません|削除されている/);
  });

  it('端末のログイン情報を読めなかったときは、端末の再起動を案内する', () => {
    assert.match(deleteAccountFailure(new AuthError('storage-failed')).message ?? '', /再起動/);
    assert.doesNotMatch(deleteAccountFailure(new AuthError('network')).message ?? '', /再起動/);
  });
});

describe('deletedNotice', () => {
  it('端末のログイン情報も消せて、Appleの連携も解除できたときは、削除したことだけ', () => {
    assert.deepEqual(deletedNotice({ sessionCleared: true, appleRevoked: true }), ['アカウントを削除しました。']);
    // Googleは失効するものが無い（null）。何も足さない
    assert.deepEqual(deletedNotice({ sessionCleared: true, appleRevoked: null }), ['アカウントを削除しました。']);
  });

  it('端末のログイン情報を消せなかったときは、ログアウトを案内する', () => {
    const lines = deletedNotice({ sessionCleared: false, appleRevoked: null });
    assert.equal(lines.length, 2);
    assert.match(lines[1] ?? '', /ログアウト/);
  });

  it('Appleの連携を解除できなかったときだけ、Appleの設定からの解除を案内する', () => {
    const lines = deletedNotice({ sessionCleared: true, appleRevoked: false });
    assert.equal(lines.length, 2);
    assert.match(lines[1] ?? '', /Apple/);
    assert.equal(deletedNotice({ sessionCleared: true, appleRevoked: true }).length, 1);
  });

  it('どちらも当てはまるときは、両方を案内する', () => {
    assert.equal(deletedNotice({ sessionCleared: false, appleRevoked: false }).length, 3);
  });
});
