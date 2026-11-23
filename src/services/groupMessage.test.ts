// グループの失敗の文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { createGroupErrorMessage, loadGroupsErrorMessage } from './groupMessage.ts';

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

describe('グループの失敗の文言', () => {
  for (const [name, message] of [
    ['loadGroupsErrorMessage', loadGroupsErrorMessage],
    ['createGroupErrorMessage', createGroupErrorMessage],
  ] as const) {
    it(`${name}: どの失敗にも文言があり、コードの文字列は出さない`, () => {
      for (const code of CODES) {
        const text = message(new AuthError(code));
        assert.ok(text.length > 0, code);
        assert.ok(!text.includes(code), code);
      }
      assert.ok(message(new Error('boom')).length > 0);
    });
  }

  it('通信の失敗と、サーバーの混雑は、やり直しを案内する（読み込み・作成とも）', () => {
    for (const message of [loadGroupsErrorMessage, createGroupErrorMessage]) {
      assert.match(message(new AuthError('network')), /もう一度/);
      assert.match(message(new AuthError('unavailable')), /しばらくしてから/);
    }
  });
});
