// 支出の一覧のHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は docs/backend-design.md 9章の
// 「支出API」と worker/src/expenses.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createExpenseRepository, type ExpenseFetchLike } from './expenseRepository.ts';

type Init = Parameters<ExpenseFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<ExpenseFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: ExpenseFetchLike = async (url, init) => {
    calls.push({ url, init });
    const result = respond(url, init);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetchImpl, calls };
}

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof AuthError && error.code === code);
}

const SESSION = 'A'.repeat(43);

// 実際の形（`allocations` などは、アプリが読まないので、ここでは載せて、読み捨てることを確かめる）
const expense = {
  id: 'e1',
  expenseDate: '2026-11-19',
  targetMonth: '2026-11',
  description: 'スーパー',
  amountMinor: 4280,
  categoryId: 'c1',
  payerMemberId: 'm1',
  createdByMemberId: 'm1',
  recurringExpenseId: null,
  splitMethod: 'equal',
  allocations: [{ memberId: 'm1', burdenMinor: 2140, shareBasisPoints: null }],
  createdAt: 1790000000000,
  updatedAt: 1790000000000,
};

describe('list', () => {
  it('GET /groups/:id/expenses?month= を呼び、支出を読む（読まない項目は捨てる）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { month: '2026-11', closed: false, expenses: [expense] }));
    const result = await createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/expenses?month=2026-11`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.deepEqual(result, {
      month: '2026-11',
      closed: false,
      expenses: [
        {
          id: 'e1',
          expenseDate: '2026-11-19',
          targetMonth: '2026-11',
          description: 'スーパー',
          amountMinor: 4280,
          categoryId: 'c1',
          payerMemberId: 'm1',
          recurringExpenseId: null,
          splitMethod: 'equal',
        },
      ],
    });
  });

  it('支出が無い月・内容が無い支出・固定費の支出を読める', async () => {
    const empty = fakeFetch(() => reply(200, { month: '2026-11', closed: true, expenses: [] }));
    assert.deepEqual(await createExpenseRepository(empty.fetchImpl).list(SESSION, 'g1', '2026-11'), {
      month: '2026-11',
      closed: true,
      expenses: [],
    });
    const { fetchImpl } = fakeFetch(() =>
      reply(200, {
        month: '2026-11',
        closed: false,
        expenses: [{ ...expense, description: null, recurringExpenseId: 'r1', splitMethod: 'category', allocations: [] }],
      }),
    );
    const [row] = (await createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11')).expenses;
    assert.equal(row?.description, null);
    assert.equal(row?.recurringExpenseId, 'r1');
    assert.equal(row?.splitMethod, 'category');
  });

  it('知らない負担の方法（サーバーが足した値）も、文字列のまま読める。一覧全体を失敗にしない', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { month: '2026-11', closed: false, expenses: [{ ...expense, splitMethod: 'weighted' }] }),
    );
    const [row] = (await createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11')).expenses;
    assert.equal(row?.splitMethod, 'weighted');
  });

  it('別の月の結果が返ったら invalid-response（その月の画面に出さない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { month: '2026-10', closed: false, expenses: [] }));
    await rejectsWith(createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11'), 'invalid-response');
  });

  it('月を渡すときは、形を確かめる（クエリに入れる値）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { month: '2026-11', closed: false, expenses: [] }));
    for (const bad of ['2026-11&x=1', '2026-13', '', '2026-1']) {
      await rejectsWith(createExpenseRepository(fetchImpl).list(SESSION, 'g1', bad), 'invalid-response');
    }
    assert.equal(calls.length, 0);
  });

  it('形の違う応答は invalid-response', async () => {
    const bad = [
      null,
      {},
      { month: '2026-11', closed: false },
      { month: '2026-11', closed: 'no', expenses: [] },
      { month: 'x', closed: false, expenses: [] },
      { month: '2026-11', closed: false, expenses: [null] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, amountMinor: '4280' }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, amountMinor: 1.5 }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, expenseDate: '2026/11/19' }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, targetMonth: '2026-13' }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, splitMethod: 1 }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, splitMethod: undefined }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, description: 1 }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, recurringExpenseId: undefined }] },
      { month: '2026-11', closed: false, expenses: [{ ...expense, payerMemberId: '' }] },
    ];
    for (const b of bad) {
      await rejectsWith(createExpenseRepository(fakeFetch(() => reply(200, b)).fetchImpl).list(SESSION, 'g1', '2026-11'), 'invalid-response');
    }
  });

  it('401 は unauthorized、403・404 は invalid-request、5xx は unavailable、通信の失敗は network', async () => {
    const list = (fetchImpl: ExpenseFetchLike) => createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11');
    await rejectsWith(list(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(list(fakeFetch(() => reply(403)).fetchImpl), 'invalid-request');
    await rejectsWith(list(fakeFetch(() => reply(404)).fetchImpl), 'invalid-request');
    await rejectsWith(list(fakeFetch(() => reply(500)).fetchImpl), 'unavailable');
    await rejectsWith(list(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});
