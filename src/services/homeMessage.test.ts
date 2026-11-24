// ホームの失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { loadHomeErrorMessage } from './homeMessage.ts';

const CODES: AuthErrorCode[] = [
  'network',
  'unavailable',
  'unauthorized',
  'invalid-request',
  'invalid-response',
  'not-signed-in',
  'storage-failed',
  'unexpected',
];

describe('loadHomeErrorMessage', () => {
  it('どの失敗にも文言があり、コードの文字列は出さない', () => {
    for (const code of CODES) {
      const text = loadHomeErrorMessage(new AuthError(code));
      assert.ok(text.length > 0, code);
      assert.ok(!text.includes(code), code);
    }
    assert.ok(loadHomeErrorMessage(new Error('x')).length > 0);
    assert.ok(loadHomeErrorMessage(undefined).length > 0);
  });

  it('やり直しても直らない失敗では、時間をおく案内をしない', () => {
    assert.ok(!loadHomeErrorMessage(new AuthError('invalid-request')).includes('時間をおいて'));
    assert.ok(loadHomeErrorMessage(new AuthError('network')).includes('もう一度'));
  });

  it('文言に、emダッシュ（長いダッシュ）を使わない', () => {
    for (const code of CODES) assert.ok(!/[\u2014\u2015\u2E3A\u2E3B]/.test(loadHomeErrorMessage(new AuthError(code))));
  });
});
