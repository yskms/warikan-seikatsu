// 固定費のHTTP（一覧・登録・変更・削除）のテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は
// docs/backend-design.md 9章の「固定費API」による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CreateRecurringRequest } from '../domain/recurring.ts';
import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createRecurringRepository, RecurringRejectedError, type RecurringFetchLike } from './recurringRepository.ts';

type Init = Parameters<RecurringFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<RecurringFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: RecurringFetchLike = async (url, init) => {
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

// 実際の形（`createdAt` などは、アプリが読まないので、ここでは載せて、読み捨てることを確かめる）
const rent = {
  id: 'r1',
  description: '家賃',
  amountMinor: 80000,
  categoryId: 'c1',
  categoryArchived: false,
  payerMemberId: 'm1',
  split: { method: 'category' },
  dayOfMonth: 25,
  startMonth: '2026-11',
  endMonth: null,
  pausedAt: null,
  pausedReason: null,
  createdAt: 1790000000000,
  updatedAt: 1790000000000,
};

describe('list', () => {
  it('GET /groups/:id/recurring-expenses を呼び、固定費を読む（読まない項目は捨てる）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { recurringExpenses: [rent] }));
    const result = await createRecurringRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/recurring-expenses`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.deepEqual(result, [
      {
        id: 'r1',
        description: '家賃',
        amountMinor: 80000,
        categoryId: 'c1',
        categoryArchived: false,
        payerMemberId: 'm1',
        split: { method: 'category' },
        dayOfMonth: 25,
        startMonth: '2026-11',
        endMonth: null,
        pausedAt: null,
        pausedReason: null,
      },
    ]);
  });

  it('固定費が無い・内容が無い・止まっている・終了月がある固定費を読める', async () => {
    const empty = fakeFetch(() => reply(200, { recurringExpenses: [] }));
    assert.deepEqual(await createRecurringRepository(empty.fetchImpl).list(SESSION, 'g1'), []);

    const { fetchImpl } = fakeFetch(() =>
      reply(200, {
        recurringExpenses: [
          { ...rent, description: null, endMonth: '2027-03', pausedAt: 1790000001000, pausedReason: 'payer_left' },
        ],
      }),
    );
    const [item] = await createRecurringRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(item.description, null);
    assert.equal(item.endMonth, '2027-03');
    assert.equal(item.pausedAt, 1790000001000);
    assert.equal(item.pausedReason, 'payer_left');
  });

  it('止めた理由の知らない値は `unknown` にして、一覧全体を失敗にしない（表示にしか使わない）', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { recurringExpenses: [{ ...rent, pausedAt: 1790000001000, pausedReason: 'something_new' }] }),
    );
    const [item] = await createRecurringRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(item.pausedReason, 'unknown');
  });

  it('負担の指定の5つの形を読む', async () => {
    const splits = [
      { method: 'equal', memberIds: ['m1', 'm2'] },
      { method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 7000 }, { memberId: 'm2', basisPoints: 3000 }] },
      { method: 'fixed', amounts: [{ memberId: 'm1', amountMinor: 50000 }, { memberId: 'm2', amountMinor: 30000 }] },
      { method: 'single', memberId: 'm2' },
    ];
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { recurringExpenses: splits.map((split, index) => ({ ...rent, id: `r${index}`, split })) }),
    );
    const items = await createRecurringRepository(fetchImpl).list(SESSION, 'g1');
    assert.deepEqual(
      items.map((item) => item.split),
      splits,
    );
  });

  it('負担の指定が読めない形（知らない方法・崩れた形・空の対象）は `null` にして、一覧全体を失敗にしない', async () => {
    const broken = [
      { method: 'weighted', weights: [] },
      { method: 'equal', memberIds: [] },
      { method: 'equal', memberIds: [1] },
      { method: 'ratio', shares: [{ memberId: 'm1' }] },
      { method: 'fixed', amounts: [] },
      { method: 'single' },
      'category',
      null,
    ];
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { recurringExpenses: [...broken.map((split, index) => ({ ...rent, id: `r${index}`, split })), { ...rent, id: 'ok' }] }),
    );
    const items = await createRecurringRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(items.length, broken.length + 1);
    assert.deepEqual(
      items.slice(0, broken.length).map((item) => item.split),
      broken.map(() => null),
    );
    assert.deepEqual(items[broken.length].split, { method: 'category' });
  });

  it('操作に使う項目が崩れていれば `invalid-response`', async () => {
    for (const patch of [
      { dayOfMonth: 0 },
      { dayOfMonth: 32 },
      { dayOfMonth: 1.5 },
      { amountMinor: '80000' },
      { startMonth: '2026-13' },
      { endMonth: '2027' },
      { categoryArchived: 'no' },
      { pausedAt: 'x' },
      { payerMemberId: 5 },
    ]) {
      const { fetchImpl } = fakeFetch(() => reply(200, { recurringExpenses: [{ ...rent, ...patch }] }));
      await rejectsWith(createRecurringRepository(fetchImpl).list(SESSION, 'g1'), 'invalid-response');
    }
    const notArray = fakeFetch(() => reply(200, { recurringExpenses: {} }));
    await rejectsWith(createRecurringRepository(notArray.fetchImpl).list(SESSION, 'g1'), 'invalid-response');
  });

  it('失敗は `AuthError`（401 は `unauthorized`）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(401, { error: 'unauthorized' }));
    await rejectsWith(createRecurringRepository(fetchImpl).list(SESSION, 'g1'), 'unauthorized');
  });
});

const createRequest: CreateRecurringRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  description: '家賃',
  amountMinor: 80000,
  categoryId: 'c1',
  payerMemberId: 'm1',
  split: { method: 'category' },
  dayOfMonth: 25,
  startMonth: '2026-11',
  currencyCode: 'JPY',
};

describe('create', () => {
  it('POST /groups/:id/recurring-expenses に本文を送り、固定費のIDと今月の分の扱いを返す（201）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, { recurringExpense: rent, thisMonthSkipped: true }));
    const result = await createRecurringRepository(fetchImpl).create(SESSION, 'g1', createRequest);
    assert.deepEqual(result, { id: 'r1', thisMonthSkipped: true });
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/recurring-expenses`);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), createRequest);
  });

  it('同じ `id` の再送の200も成功として読む', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { recurringExpense: rent, thisMonthSkipped: false }));
    assert.deepEqual(await createRecurringRepository(fetchImpl).create(SESSION, 'g1', createRequest), {
      id: 'r1',
      thisMonthSkipped: false,
    });
  });

  it('応答は使う項目だけを検べる: 固定費の他の項目が崩れていても、`id` があれば成功。`thisMonthSkipped` が無い・崩れているときは false', async () => {
    const loose = fakeFetch(() => reply(201, { recurringExpense: { id: 'r1', dayOfMonth: 'x' } }));
    assert.deepEqual(await createRecurringRepository(loose.fetchImpl).create(SESSION, 'g1', createRequest), {
      id: 'r1',
      thisMonthSkipped: false,
    });
    const odd = fakeFetch(() => reply(201, { recurringExpense: { id: 'r1' }, thisMonthSkipped: 'yes' }));
    assert.deepEqual(await createRecurringRepository(odd.fetchImpl).create(SESSION, 'g1', createRequest), {
      id: 'r1',
      thisMonthSkipped: false,
    });
  });

  it('固定費のIDが読めない200（Wi-Fiの認証画面など）は `invalid-response`', async () => {
    for (const body of [{}, { recurringExpense: {} }, { recurringExpense: { id: 5 } }, { recurringExpense: null }]) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createRecurringRepository(fetchImpl).create(SESSION, 'g1', createRequest), 'invalid-response');
    }
  });

  it('断られたら `RecurringRejectedError` に、理由・直す項目・使えないメンバーを載せる', async () => {
    const cases: { status: number; body: unknown; reason: string | null; field: string | null; memberId: string | null }[] = [
      { status: 409, body: { error: 'member_not_available', memberId: 'm2' }, reason: 'member_not_available', field: null, memberId: 'm2' },
      { status: 400, body: { error: 'invalid_request', field: 'split.amounts' }, reason: 'invalid_request', field: 'split.amounts', memberId: null },
      { status: 409, body: { error: 'too_many_recurring_expenses' }, reason: 'too_many_recurring_expenses', field: null, memberId: null },
      { status: 409, body: { error: 'category_not_available' }, reason: 'category_not_available', field: null, memberId: null },
      { status: 403, body: { error: 'forbidden' }, reason: 'forbidden', field: null, memberId: null },
      { status: 404, body: { error: 'not_found' }, reason: 'not_found', field: null, memberId: null },
    ];
    for (const item of cases) {
      const { fetchImpl } = fakeFetch(() => reply(item.status, item.body));
      await assert.rejects(createRecurringRepository(fetchImpl).create(SESSION, 'g1', createRequest), (error) => {
        assert.ok(error instanceof RecurringRejectedError);
        assert.equal(error.code, 'invalid-request');
        assert.equal(error.status, item.status);
        assert.equal(error.reason, item.reason);
        assert.equal(error.field, item.field);
        assert.equal(error.memberId, item.memberId);
        return true;
      });
    }
  });

  it('断られた応答が読めなくても、`invalid-request` を保つ（形の崩れた `memberId` は載せない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(409, { error: 'member_not_available', memberId: { x: 1 } }));
    await assert.rejects(createRecurringRepository(fetchImpl).create(SESSION, 'g1', createRequest), (error) => {
      assert.ok(error instanceof RecurringRejectedError);
      assert.equal(error.memberId, null);
      return true;
    });
  });

  it('通信できなければ `network`、混み合っていれば `unavailable`', async () => {
    const down = fakeFetch(() => new TypeError('Network request failed'));
    await rejectsWith(createRecurringRepository(down.fetchImpl).create(SESSION, 'g1', createRequest), 'network');
    const busy = fakeFetch(() => reply(503, {}));
    await rejectsWith(createRecurringRepository(busy.fetchImpl).create(SESSION, 'g1', createRequest), 'unavailable');
  });
});

describe('update', () => {
  it('PATCH /recurring-expenses/:id に、変えるものだけを送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { recurringExpense: rent, thisMonthSkipped: false }));
    const result = await createRecurringRepository(fetchImpl).update(SESSION, 'r1', {
      amountMinor: 85000,
      currencyCode: 'JPY',
      endMonth: null,
    });
    assert.deepEqual(result, { id: 'r1', thisMonthSkipped: false });
    assert.equal(calls[0].url, `${API_ORIGIN}/recurring-expenses/r1`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { amountMinor: 85000, currencyCode: 'JPY', endMonth: null });
  });

  it('止める・再開するも、`paused` を送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { recurringExpense: rent, thisMonthSkipped: true }));
    const repository = createRecurringRepository(fetchImpl);
    assert.deepEqual(await repository.update(SESSION, 'r1', { paused: true }), { id: 'r1', thisMonthSkipped: true });
    await repository.update(SESSION, 'r1', { paused: false, payerMemberId: 'm2', split: { method: 'single', memberId: 'm2' } });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { paused: true });
    assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
      paused: false,
      payerMemberId: 'm2',
      split: { method: 'single', memberId: 'm2' },
    });
  });

  it('断られたら `RecurringRejectedError`（再開の `split` の求めなど）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(400, { error: 'invalid_request', field: 'split' }));
    await assert.rejects(createRecurringRepository(fetchImpl).update(SESSION, 'r1', { paused: false }), (error) => {
      assert.ok(error instanceof RecurringRejectedError);
      assert.equal(error.field, 'split');
      return true;
    });
  });
});

describe('remove', () => {
  it('DELETE /recurring-expenses/:id（204）。本文は読まない', async () => {
    const { fetchImpl, calls } = fakeFetch(() => Promise.resolve({ ok: true, status: 204, json: async () => Promise.reject(new Error('no body')) }));
    await createRecurringRepository(fetchImpl).remove(SESSION, 'r1');
    assert.equal(calls[0].url, `${API_ORIGIN}/recurring-expenses/r1`);
    assert.equal(calls[0].init.method, 'DELETE');
  });

  it('一度でも支出を作った固定費は 409 `recurring_expense_in_use`、すでに無ければ 404', async () => {
    const inUse = fakeFetch(() => reply(409, { error: 'recurring_expense_in_use' }));
    await assert.rejects(createRecurringRepository(inUse.fetchImpl).remove(SESSION, 'r1'), (error) => {
      assert.ok(error instanceof RecurringRejectedError);
      assert.equal(error.reason, 'recurring_expense_in_use');
      return true;
    });
    const gone = fakeFetch(() => reply(404, { error: 'not_found' }));
    await assert.rejects(createRecurringRepository(gone.fetchImpl).remove(SESSION, 'r1'), (error) => {
      assert.ok(error instanceof RecurringRejectedError);
      assert.equal(error.reason, 'not_found');
      return true;
    });
  });
});
