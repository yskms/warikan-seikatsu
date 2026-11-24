// 補助の読み込みのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { bestEffort } from './bestEffort.ts';

describe('bestEffort', () => {
  it('読めたら、その値を返す', async () => {
    assert.deepEqual(await bestEffort(Promise.resolve([1, 2])), [1, 2]);
  });

  it('401（unauthorized）は、握りつぶさずに投げる（セッション切れを、withSession の層が捨てて伝えるため）', async () => {
    await assert.rejects(
      bestEffort(Promise.reject(new AuthError('unauthorized'))),
      (e: unknown) => e instanceof AuthError && e.code === 'unauthorized',
    );
  });

  it('それ以外の失敗（通信・サーバー・応答の形・書き込みの断り）は、null にする', async () => {
    for (const code of ['network', 'unavailable', 'invalid-response', 'invalid-request'] as const) {
      assert.equal(await bestEffort(Promise.reject(new AuthError(code))), null, code);
    }
    assert.equal(await bestEffort(Promise.reject(new Error('想定外'))), null);
  });
});
