// 支出を保存したあとのお知らせの入れ物のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createExpenseNoticeStore } from './expenseNotice.ts';

describe('createExpenseNoticeStore', () => {
  it('置いた月を、1回だけ取り出せる', () => {
    const store = createExpenseNoticeStore();
    assert.equal(store.take(), null);
    store.post('2026-11');
    assert.equal(store.take(), '2026-11');
    assert.equal(store.take(), null);
  });

  it('続けて置くと、最新の1件だけが残る', () => {
    const store = createExpenseNoticeStore();
    store.post('2026-10');
    store.post('2026-11');
    assert.equal(store.take(), '2026-11');
  });
});
