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

  it('アプリ・サーバーの食い違い（invalid-request・invalid-response）は、時間をおく案内にしない', () => {
    for (const message of [loadGroupsErrorMessage, createGroupErrorMessage]) {
      for (const code of ['invalid-request', 'invalid-response'] as const) {
        const text = message(new AuthError(code));
        assert.doesNotMatch(text, /時間をおいて|しばらくしてから/, `${message.name} ${code}`);
        assert.notEqual(text, message(new AuthError('unexpected')), `${message.name} ${code}`);
      }
    }
  });

  it('作成で応答を読めなかったときは、作られている場合があることを伝える', () => {
    assert.match(createGroupErrorMessage(new AuthError('invalid-response')), /作られている場合/);
    // 作成の入力が通らなかったときは、タイムゾーン（端末の日付と時刻の設定）を案内する
    assert.match(createGroupErrorMessage(new AuthError('invalid-request')), /日付と時刻/);
  });
});
