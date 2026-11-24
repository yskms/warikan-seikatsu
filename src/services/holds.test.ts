// 割り込みを遅らせる入れ物のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHolds } from './holds.ts';

describe('createHolds', () => {
  it('acquire で増え、戻り値で減る。最初は0', () => {
    const holds = createHolds();
    assert.equal(holds.count.get(), 0);
    const release = holds.acquire();
    assert.equal(holds.count.get(), 1);
    release();
    assert.equal(holds.count.get(), 0);
  });

  it('手放す関数は、何度呼んでも1回しか減らさない（ほかの画面の分まで減らさない）', () => {
    const holds = createHolds();
    const first = holds.acquire();
    const second = holds.acquire();
    first();
    first();
    first();
    assert.equal(holds.count.get(), 1);
    second();
    assert.equal(holds.count.get(), 0);
  });

  it('複数あるあいだは、0にならない。変わるたびに購読者へ知らせる', () => {
    const holds = createHolds();
    const seen: number[] = [];
    holds.count.subscribe(() => seen.push(holds.count.get()));
    const a = holds.acquire();
    const b = holds.acquire();
    a();
    assert.equal(holds.count.get(), 1);
    b();
    assert.deepEqual(seen, [1, 2, 1, 0]);
  });
});
