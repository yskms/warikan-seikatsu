// 起動時のログイン判定のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuthProvider } from '../domain/types.ts';
import { AuthError } from '../repositories/authError.ts';
import { checkSession, checkSessionOnce, RETRY_DELAYS_MS } from './sessionCheck.ts';

/** 呼ばれるたびに、順に結果（値か失敗）を返す偽のアカウント。使い切ったら最後の結果を返す。 */
function account(results: (AuthProvider | null | AuthError)[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async getSignedInProvider() {
      const result = results[Math.min(calls, results.length - 1)];
      calls += 1;
      if (result instanceof AuthError) throw result;
      return result ?? null;
    },
  };
}

describe('checkSession', () => {
  it('サインイン中なら、読み直さず signed-in', async () => {
    const a = account(['apple']);
    const slept: number[] = [];
    assert.equal(await checkSession(a, { sleep: async (ms) => void slept.push(ms) }), 'signed-in');
    assert.equal(a.calls, 1);
    assert.deepEqual(slept, []);
  });

  it('サインインしていなければ、読み直さず signed-out（保存先を読めた「何も無い」は、読めないとは別）', async () => {
    const a = account([null]);
    assert.equal(await checkSession(a, { sleep: async () => {} }), 'signed-out');
    assert.equal(a.calls, 1);
  });

  it('storage-failed のあとに読めたら、その結果（ロック中の一時的な失敗）', async () => {
    const a = account([new AuthError('storage-failed'), new AuthError('storage-failed'), 'google']);
    const slept: number[] = [];
    assert.equal(await checkSession(a, { sleep: async (ms) => void slept.push(ms) }), 'signed-in');
    assert.equal(a.calls, 3);
    assert.deepEqual(slept, [500, 1000]);
  });

  it('読み直しても読めなければ unreadable（最初の1回と、待ちの数だけ読み直す）', async () => {
    const a = account([new AuthError('storage-failed')]);
    const slept: number[] = [];
    assert.equal(await checkSession(a, { sleep: async (ms) => void slept.push(ms) }), 'unreadable');
    assert.equal(a.calls, 1 + RETRY_DELAYS_MS.length);
    assert.deepEqual(slept, [...RETRY_DELAYS_MS]);
  });

  it('想定外の失敗（unexpected）も、読めなかったものとして扱う（起動を止めない）', async () => {
    const a = account([new AuthError('unexpected')]);
    assert.equal(await checkSession(a, { delaysMs: [], sleep: async () => {} }), 'unreadable');
  });

  it('待ちを空にすると、読み直さない', async () => {
    const a = account([new AuthError('storage-failed')]);
    assert.equal(await checkSession(a, { delaysMs: [] }), 'unreadable');
    assert.equal(a.calls, 1);
  });
});

describe('checkSessionOnce', () => {
  it('読み直さずに、1回だけ読む', async () => {
    const a = account([new AuthError('storage-failed'), 'apple']);
    assert.equal(await checkSessionOnce(a), 'unreadable');
    assert.equal(a.calls, 1);
  });
});
