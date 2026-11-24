// 招待のトークンの入れ物と、値の入れ物（valueStore）のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPendingInvite } from './pendingInvite.ts';
import { createValueStore } from './valueStore.ts';

describe('createValueStore', () => {
  it('値を変えると、購読している側へ知らせる。同じ値なら知らせない', () => {
    const store = createValueStore<string | null>(null);
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.set('a');
    store.set('a');
    assert.equal(store.get(), 'a');
    assert.equal(calls, 1);
    store.set(null);
    assert.equal(calls, 2);
  });

  it('解除したあとは、知らせない。購読者が投げても、ほかの購読者へ届く', () => {
    const store = createValueStore(0);
    let first = 0;
    let second = 0;
    const stop = store.subscribe(() => (first += 1));
    store.subscribe(() => {
      second += 1;
      throw new Error('受け取る側の失敗');
    });
    store.set(1);
    stop();
    store.set(2);
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(store.get(), 2);
  });

  it('通知の最中に解除しても、その回の通知は壊れない', () => {
    const store = createValueStore(0);
    const log: string[] = [];
    const stop = store.subscribe(() => {
      log.push('a');
      stop();
    });
    store.subscribe(() => log.push('b'));
    store.set(1);
    assert.deepEqual(log, ['a', 'b']);
  });
});

describe('createPendingInvite', () => {
  it('最初は何も持たない。set で持ち、新しい招待URLで置き換える', () => {
    const pending = createPendingInvite();
    assert.equal(pending.get(), null);
    pending.set('T1');
    assert.equal(pending.get(), 'T1');
    pending.set('T2');
    assert.equal(pending.get(), 'T2');
  });

  it('clear は、持っているトークンと同じときだけ手放す（古い招待の終わりが、新しい招待を消さない）', () => {
    const pending = createPendingInvite();
    pending.set('T1');
    pending.set('T2');
    pending.clear('T1');
    assert.equal(pending.get(), 'T2');
    pending.clear('T2');
    assert.equal(pending.get(), null);
  });

  it('持つ・手放すを購読者へ知らせる。手放すものが無いときは知らせない', () => {
    const pending = createPendingInvite();
    const seen: (string | null)[] = [];
    pending.subscribe(() => seen.push(pending.get()));
    pending.clear('T1');
    pending.set('T1');
    pending.clear('T1');
    assert.deepEqual(seen, ['T1', null]);
  });
});
