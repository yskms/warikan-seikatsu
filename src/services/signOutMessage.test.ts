// ログアウトの失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { signOutErrorMessage } from './signOutMessage.ts';

describe('signOutErrorMessage', () => {
  it('どの失敗にも文言があり、コードの文字列は出さない', () => {
    const codes: AuthErrorCode[] = ['network', 'unavailable', 'storage-failed', 'unexpected'];
    for (const code of codes) {
      const text = signOutErrorMessage(new AuthError(code));
      assert.ok(text.length > 0, code);
      assert.ok(!text.includes(code), code);
    }
    assert.ok(signOutErrorMessage(new Error('boom')).length > 0);
  });

  it('保存先の失敗だけ、端末の再起動を案内する', () => {
    assert.match(signOutErrorMessage(new AuthError('storage-failed')), /再起動/);
    assert.doesNotMatch(signOutErrorMessage(new AuthError('network')), /再起動/);
  });
});
