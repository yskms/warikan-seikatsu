// ログインの失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { isAlreadySignedIn, providerName, signInErrorMessage } from './signInMessage.ts';

describe('signInErrorMessage', () => {
  it('取りやめは何も出さない', () => {
    assert.equal(signInErrorMessage(new AuthError('cancelled'), 'apple'), null);
  });

  it('すでにサインイン済みは文言を出さない（画面が、ログイン済みとして扱い直す）', () => {
    assert.equal(signInErrorMessage(new AuthError('already-signed-in'), 'google'), null);
    assert.equal(isAlreadySignedIn(new AuthError('already-signed-in')), true);
    assert.equal(isAlreadySignedIn(new AuthError('network')), false);
    assert.equal(isAlreadySignedIn(new Error('x')), false);
  });

  it('ほかの失敗は、どれも文言がある（コードの文字列は出さない）', () => {
    const codes: AuthErrorCode[] = [
      'network',
      'unavailable',
      'unauthorized',
      'invalid-request',
      'invalid-response',
      'provider-unavailable',
      'provider-failed',
      'timeout',
      'not-signed-in',
      'reauth-failed',
      'account-mismatch',
      'storage-failed',
      'delete-unconfirmed',
      'unexpected',
    ];
    for (const code of codes) {
      const message = signInErrorMessage(new AuthError(code), 'apple');
      assert.ok(typeof message === 'string' && message.length > 0, code);
      assert.ok(!message.includes(code), code);
    }
  });

  it('AuthError でない失敗は、想定外として文言を出す', () => {
    assert.equal(
      signInErrorMessage(new Error('boom'), 'apple'),
      signInErrorMessage(new AuthError('unexpected'), 'apple'),
    );
  });

  it('provider-failed・provider-unavailable は、ログイン手段の名前が入る', () => {
    assert.match(signInErrorMessage(new AuthError('provider-failed'), 'apple')!, /Apple/);
    assert.match(signInErrorMessage(new AuthError('provider-unavailable'), 'google')!, /Google/);
  });

  it('providerName', () => {
    assert.equal(providerName('apple'), 'Apple');
    assert.equal(providerName('google'), 'Google');
  });
});
