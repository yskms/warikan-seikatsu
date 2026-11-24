// 支出のHTTP（一覧・1件の取得・登録・編集・削除）のテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は docs/backend-design.md 9章の
// 「支出API」と worker/src/expenses.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createExpenseRepository, ExpenseRejectedError, type ExpenseFetchLike } from './expenseRepository.ts';
import type { CreateExpenseRequest } from '../domain/expense.ts';

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

describe('get（編集のシートを開く）', () => {
  const equal = {
    ...expense,
    splitMethod: 'ratio',
    allocations: [
      { memberId: 'm1', burdenMinor: 2996, shareBasisPoints: 7000 },
      { memberId: 'm2', burdenMinor: 1284, shareBasisPoints: 3000 },
    ],
  };

  it('その月の一覧から、IDの一致する支出を、負担額つきで返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      reply(200, { month: '2026-11', closed: false, expenses: [{ ...expense, id: 'e0' }, equal] }),
    );
    const result = await createExpenseRepository(fetchImpl).get(SESSION, 'g1', '2026-11', 'e1');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/expenses?month=2026-11`);
    assert.equal(calls[0].init.method, 'GET');
    assert.deepEqual(result?.allocations, [
      { memberId: 'm1', burdenMinor: 2996, shareBasisPoints: 7000 },
      { memberId: 'm2', burdenMinor: 1284, shareBasisPoints: 3000 },
    ]);
    assert.equal(result?.closed, false);
    assert.equal(result?.splitMethod, 'ratio');
  });

  it('締めた月は closed: true。見つからなければ null（別のメンバーが削除した）', async () => {
    const closed = fakeFetch(() => reply(200, { month: '2026-11', closed: true, expenses: [equal] }));
    assert.equal((await createExpenseRepository(closed.fetchImpl).get(SESSION, 'g1', '2026-11', 'e1'))?.closed, true);
    const none = fakeFetch(() => reply(200, { month: '2026-11', closed: false, expenses: [equal] }));
    assert.equal(await createExpenseRepository(none.fetchImpl).get(SESSION, 'g1', '2026-11', 'zzz'), null);
  });

  it('編集が依存する負担額は、形が違えば invalid-response。別の月の結果も', async () => {
    const bad = [
      { ...equal, allocations: undefined },
      { ...equal, allocations: [{ memberId: 'm1', burdenMinor: '1', shareBasisPoints: null }] },
      { ...equal, allocations: [{ memberId: 'm1', burdenMinor: 1 }] },
      { ...equal, allocations: [null] },
    ];
    for (const row of bad) {
      const { fetchImpl } = fakeFetch(() => reply(200, { month: '2026-11', closed: false, expenses: [row] }));
      await rejectsWith(createExpenseRepository(fetchImpl).get(SESSION, 'g1', '2026-11', 'e1'), 'invalid-response');
    }
    const other = fakeFetch(() => reply(200, { month: '2026-10', closed: false, expenses: [] }));
    await rejectsWith(createExpenseRepository(other.fetchImpl).get(SESSION, 'g1', '2026-11', 'e1'), 'invalid-response');
  });

  it('一覧（ホーム）は、負担額が壊れていても読める（ホーム全体を失敗にしない）', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { month: '2026-11', closed: false, expenses: [{ ...expense, allocations: 'broken' }] }),
    );
    assert.equal((await createExpenseRepository(fetchImpl).list(SESSION, 'g1', '2026-11')).expenses.length, 1);
  });
});

const createRequest: CreateExpenseRequest = {
  id: '3f2b9c1e-0a4d-4f6b-9d2e-1c7a8b5e4f30',
  expenseDate: '2026-11-19',
  targetMonth: '2026-11',
  description: 'スーパー',
  amountMinor: 4280,
  categoryId: 'c1',
  payerMemberId: 'm1',
  split: { method: 'category' },
  currencyCode: 'JPY',
};

describe('create', () => {
  it('POST /groups/:id/expenses に本文を送り、id だけを読む（201も、再送の200も成功）', async () => {
    for (const status of [201, 200]) {
      const { fetchImpl, calls } = fakeFetch(() => reply(status, { expense }));
      const result = await createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest);
      assert.deepEqual(result, { id: 'e1' });
      assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/expenses`);
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
      assert.deepEqual(JSON.parse(calls[0].init.body ?? ''), createRequest);
    }
  });

  it('応答の、使わない項目が崩れていても、成功にする（サーバーでは登録が済んでいるため。CLAUDE.md）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(201, { expense: { id: 'e1', amountMinor: 'broken', allocations: 1 } }));
    assert.deepEqual(await createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest), { id: 'e1' });
  });

  it('id を読めない応答（JSONでない200など）は invalid-response', async () => {
    for (const body of [null, {}, { expense: null }, { expense: {} }, { expense: { id: '' } }, { expense: { id: 1 } }]) {
      const { fetchImpl } = fakeFetch(() => reply(201, body));
      await rejectsWith(createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest), 'invalid-response');
    }
  });

  it('断られたときは、サーバーの理由を載せた ExpenseRejectedError（invalid-request）', async () => {
    const cases: [number, unknown, Partial<ExpenseRejectedError>][] = [
      [409, { error: 'conflict' }, { reason: 'conflict' }],
      [409, { error: 'month_not_registerable', from: '2026-12', to: '2026-12' }, { reason: 'month_not_registerable', from: '2026-12', to: '2026-12' }],
      [409, { error: 'member_not_available', memberId: 'm2' }, { reason: 'member_not_available', memberId: 'm2' }],
      [400, { error: 'invalid_request', field: 'split.amounts' }, { reason: 'invalid_request', field: 'split.amounts' }],
      [403, { error: 'forbidden' }, { reason: 'forbidden' }],
    ];
    for (const [status, body, expected] of cases) {
      const { fetchImpl } = fakeFetch(() => reply(status, body));
      await assert.rejects(createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest), (error) => {
        assert.ok(error instanceof ExpenseRejectedError);
        assert.equal(error.code, 'invalid-request');
        assert.equal(error.status, status);
        for (const [key, value] of Object.entries(expected)) assert.equal(error[key as keyof ExpenseRejectedError], value, key);
        return true;
      });
    }
  });

  it('理由の本文が読めない・形が違う断りは、理由なしの invalid-request（月の形でない値は載せない）', async () => {
    const unreadable: ExpenseFetchLike = async () => ({
      ok: false,
      status: 409,
      json: async () => {
        throw new Error('not json');
      },
    });
    await rejectsWith(createExpenseRepository(unreadable).create(SESSION, 'g1', createRequest), 'invalid-request');
    const { fetchImpl } = fakeFetch(() => reply(409, { error: 'month_not_registerable', from: 'x', to: 5, memberId: '日本語' }));
    await assert.rejects(createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest), (error) => {
      assert.ok(error instanceof ExpenseRejectedError);
      assert.deepEqual([error.from, error.to, error.memberId], [null, null, null]);
      return true;
    });
  });

  it('401 は unauthorized、5xx は unavailable、通信の失敗は network', async () => {
    const create = (fetchImpl: ExpenseFetchLike) => createExpenseRepository(fetchImpl).create(SESSION, 'g1', createRequest);
    await rejectsWith(create(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(create(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(create(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

describe('update', () => {
  it('PATCH /expenses/:id に、変えるものだけを送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { expense }));
    const result = await createExpenseRepository(fetchImpl).update(SESSION, 'e/1', { description: null, expenseDate: '2026-11-20' });
    assert.deepEqual(result, { id: 'e1' });
    assert.equal(calls[0].url, `${API_ORIGIN}/expenses/e%2F1`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body ?? ''), { description: null, expenseDate: '2026-11-20' });
  });

  it('締めた月・競合は、理由つきで断られる', async () => {
    const { fetchImpl } = fakeFetch(() => reply(409, { error: 'month_closed' }));
    await assert.rejects(createExpenseRepository(fetchImpl).update(SESSION, 'e1', { description: 'x' }), (error) => {
      return error instanceof ExpenseRejectedError && error.reason === 'month_closed' && error.status === 409;
    });
  });
});

describe('remove', () => {
  it('DELETE /expenses/:id を呼ぶ（204。本文は読まない）', async () => {
    const noBody: ExpenseFetchLike = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      return {
        ok: true,
        status: 204,
        json: async () => {
          throw new Error('no body');
        },
      };
    };
    const calls: { url: string; method: string; body: string | undefined }[] = [];
    await createExpenseRepository(noBody).remove(SESSION, 'e1');
    assert.deepEqual(calls, [{ url: `${API_ORIGIN}/expenses/e1`, method: 'DELETE', body: undefined }]);
  });

  it('すでに無い（404）・締めた月（409）は、理由つきで断られる', async () => {
    for (const [status, reason] of [[404, 'not_found'], [409, 'month_closed']] as const) {
      const { fetchImpl } = fakeFetch(() => reply(status, { error: reason }));
      await assert.rejects(createExpenseRepository(fetchImpl).remove(SESSION, 'e1'), (error) => {
        return error instanceof ExpenseRejectedError && error.reason === reason;
      });
    }
  });
});
