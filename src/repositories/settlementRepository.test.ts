// 月締め・精算完了・繰越のHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かすので、実際のサーバーには通信しない
// （応答の形は docs/backend-design.md 9章の「月締め・精算API」と worker/src/closings.ts・transfers.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createSettlementRepository, SettlementRejectedError, type SettlementFetchLike } from './settlementRepository.ts';

type Init = Parameters<SettlementFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<SettlementFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: SettlementFetchLike = async (url, init) => {
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

// 締めた結果（`MonthView`）。リポジトリは `closed` だけを読む
const closedView = {
  month: '2026-10',
  closed: true,
  closing: { id: 'cl1', closedAt: 1790000000000, closedByMemberId: 'm1', processed: false },
  totalMinor: 14000,
  members: [],
  categories: [],
  transfers: [],
};

describe('close', () => {
  it('POST /groups/:id/months/:month/close を、本文なしで送る。締めた（201）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, closedView));
    const result = await createSettlementRepository(fetchImpl).close(SESSION, 'g/1', '2026-10');
    assert.deepEqual(result, { kind: 'closed' });
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g%2F1/months/2026-10/close`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  });

  it('最後の1人の脱退でグループごと消したときは、group-deleted（締めてはいない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { groupDeleted: true }));
    assert.deepEqual(await createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-10'), { kind: 'group-deleted' });
  });

  it('使うのは `closed` だけ。結果のほかの項目が崩れていても、締めたことは成功にする', () => {
    const { fetchImpl } = fakeFetch(() => reply(201, { closed: true, members: 'x', transfers: null }));
    return createSettlementRepository(fetchImpl)
      .close(SESSION, 'g1', '2026-10')
      .then((result) => assert.deepEqual(result, { kind: 'closed' }));
  });

  it('締めたかどうかを読めない応答（JSONでない200など）は invalid-response', async () => {
    for (const body of [null, {}, [], 'ok', { closed: false }, { closed: 'yes' }, { groupDeleted: false }]) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-10'), 'invalid-response');
    }
  });

  it('月の形が違えば、送らずに invalid-response（パスに入れる前に検べる）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, closedView));
    await rejectsWith(createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-13'), 'invalid-response');
    await rejectsWith(createSettlementRepository(fetchImpl).close(SESSION, 'g1', '../x'), 'invalid-response');
    assert.equal(calls.length, 0);
  });

  it('断られたときは、サーバーの理由を載せた SettlementRejectedError（invalid-request）', async () => {
    const cases: [number, unknown, Partial<SettlementRejectedError>][] = [
      [409, { error: 'conflict' }, { reason: 'conflict' }],
      [409, { error: 'month_closed' }, { reason: 'month_closed' }],
      [409, { error: 'month_skipped' }, { reason: 'month_skipped' }],
      [409, { error: 'month_not_started' }, { reason: 'month_not_started' }],
      [409, { error: 'previous_month_not_closed', month: '2026-09' }, { reason: 'previous_month_not_closed', month: '2026-09' }],
      [409, { error: 'previous_month_unsettled', month: '2026-09' }, { reason: 'previous_month_unsettled', month: '2026-09' }],
      [403, { error: 'forbidden' }, { reason: 'forbidden' }],
      [404, { error: 'not_found' }, { reason: 'not_found' }],
    ];
    for (const [status, body, expected] of cases) {
      const { fetchImpl } = fakeFetch(() => reply(status, body));
      await assert.rejects(createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-10'), (error) => {
        assert.ok(error instanceof SettlementRejectedError);
        assert.equal(error.code, 'invalid-request');
        assert.equal(error.status, status);
        for (const [key, value] of Object.entries(expected)) assert.equal(error[key as keyof SettlementRejectedError], value, key);
        return true;
      });
    }
  });

  it('理由の本文が読めない・形が違う断りは、理由なしの invalid-request（月の形でない値は載せない）', async () => {
    const unreadable: SettlementFetchLike = async () => ({
      ok: false,
      status: 409,
      json: async () => {
        throw new Error('not json');
      },
    });
    await rejectsWith(createSettlementRepository(unreadable).close(SESSION, 'g1', '2026-10'), 'invalid-request');
    const { fetchImpl } = fakeFetch(() => reply(409, { error: 'previous_month_unsettled', month: 'x', status: 5 }));
    await assert.rejects(createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-10'), (error) => {
      assert.ok(error instanceof SettlementRejectedError);
      assert.equal(error.reason, 'previous_month_unsettled');
      assert.deepEqual([error.month, error.transferStatus], [null, null]);
      return true;
    });
  });

  it('401 は unauthorized、429・5xx は unavailable、通信の失敗は network。再試行はしない', async () => {
    const close = (fetchImpl: SettlementFetchLike) => createSettlementRepository(fetchImpl).close(SESSION, 'g1', '2026-10');
    await rejectsWith(close(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(close(fakeFetch(() => reply(429)).fetchImpl), 'unavailable');
    const failing = fakeFetch(() => reply(503));
    await rejectsWith(close(failing.fetchImpl), 'unavailable');
    assert.equal(failing.calls.length, 1);
    await rejectsWith(close(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

describe('settle / carry', () => {
  const transfer = { id: 't1', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 3000, status: 'settled', canCarry: false };

  it('POST /transfers/:id/settle・carry を、本文なしで送る。応答の transfer.id だけを読む', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { transfer }));
    const repository = createSettlementRepository(fetchImpl);
    assert.deepEqual(await repository.settle(SESSION, 't/1'), { id: 't1' });
    assert.deepEqual(await repository.carry(SESSION, 't1'), { id: 't1' });
    assert.deepEqual(
      calls.map((call) => [call.init.method, call.url, call.init.body]),
      [
        ['POST', `${API_ORIGIN}/transfers/t%2F1/settle`, undefined],
        ['POST', `${API_ORIGIN}/transfers/t1/carry`, undefined],
      ],
    );
  });

  it('transfer.id を読めない応答（JSONでない200など）は invalid-response。ほかの項目の崩れは許す', async () => {
    for (const body of [null, {}, { transfer: null }, { transfer: {} }, { transfer: { id: '' } }, { transfer: { id: 1 } }]) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createSettlementRepository(fetchImpl).settle(SESSION, 't1'), 'invalid-response');
      await rejectsWith(createSettlementRepository(fetchImpl).carry(SESSION, 't1'), 'invalid-response');
    }
    const { fetchImpl } = fakeFetch(() => reply(200, { transfer: { id: 't1', status: 5, canCarry: 'x' } }));
    assert.deepEqual(await createSettlementRepository(fetchImpl).settle(SESSION, 't1'), { id: 't1' });
  });

  it('断られたときは、理由と、処理済みの送金のいまの状態を載せる', async () => {
    const cases: [number, unknown, Partial<SettlementRejectedError>][] = [
      [409, { error: 'transfer_not_pending', status: 'settled' }, { reason: 'transfer_not_pending', transferStatus: 'settled' }],
      [409, { error: 'transfer_not_pending', status: 'carried' }, { reason: 'transfer_not_pending', transferStatus: 'carried' }],
      [409, { error: 'transfer_not_carryable' }, { reason: 'transfer_not_carryable' }],
      [409, { error: 'conflict' }, { reason: 'conflict' }],
      [404, { error: 'not_found' }, { reason: 'not_found' }],
    ];
    for (const [status, body, expected] of cases) {
      const { fetchImpl } = fakeFetch(() => reply(status, body));
      await assert.rejects(createSettlementRepository(fetchImpl).carry(SESSION, 't1'), (error) => {
        assert.ok(error instanceof SettlementRejectedError);
        assert.equal(error.code, 'invalid-request');
        assert.equal(error.status, status);
        for (const [key, value] of Object.entries(expected)) assert.equal(error[key as keyof SettlementRejectedError], value, key);
        return true;
      });
    }
  });

  it('401 は unauthorized、5xx は unavailable、通信の失敗は network', async () => {
    const settle = (fetchImpl: SettlementFetchLike) => createSettlementRepository(fetchImpl).settle(SESSION, 't1');
    await rejectsWith(settle(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(settle(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(settle(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});
