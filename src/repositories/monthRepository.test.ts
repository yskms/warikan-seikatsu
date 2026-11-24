// 月の一覧・月の集計のHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かすので、実際のサーバーには通信しない
// （応答の形は docs/backend-design.md 9章の「月締め・精算API」と worker/src/closings.ts・monthList.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createMonthRepository, type MonthFetchLike } from './monthRepository.ts';

type Init = Parameters<MonthFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<MonthFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: MonthFetchLike = async (url, init) => {
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

const monthMember = {
  memberId: 'm1',
  displayName: 'あなた',
  paidMinor: 10000,
  burdenMinor: 7000,
  differenceMinor: 3000,
  carriedInMinor: 0,
  netMinor: 3000,
};

// 締める前の月（見込み）
const estimate = {
  month: '2026-11',
  closed: false,
  closing: null,
  totalMinor: 14000,
  members: [monthMember],
  categories: [{ categoryId: 'c1', totalMinor: 14000, burdens: [{ memberId: 'm1', burdenMinor: 7000 }] }],
  transfers: [{ fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 3000 }],
  close: { closable: false, reason: 'previous_month_not_closed', month: '2026-10' },
};

// 締めた月
const closedView = {
  ...estimate,
  month: '2026-10',
  closed: true,
  closing: { id: 'cl1', closedAt: 1790000000000, closedByMemberId: 'm1', processed: false },
  transfers: [
    {
      id: 't1',
      fromMemberId: 'm2',
      toMemberId: 'm1',
      amountMinor: 3000,
      status: 'pending',
      settledAt: null,
      carriedAt: null,
      processedByMemberId: null,
      canCarry: true,
    },
  ],
  close: { closable: false, reason: 'month_closed' },
};

describe('list', () => {
  const body = {
    currentMonth: '2026-11',
    months: [
      { month: '2026-10', status: 'unsettled' },
      { month: '2026-11', status: 'open' },
    ],
  };

  it('GET /groups/:id/months を、セッションつきで呼び、月の一覧を返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, body));
    assert.deepEqual(await createMonthRepository(fetchImpl).list(SESSION, 'g1'), body);
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/months`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.equal(calls[0].init.body, undefined);
  });

  it('4つの状態を読める', async () => {
    const all = {
      currentMonth: '2026-11',
      months: ['open', 'skipped', 'unsettled', 'settled'].map((status, i) => ({ month: `2026-0${i + 1}`, status })),
    };
    const { fetchImpl } = fakeFetch(() => reply(200, all));
    const result = await createMonthRepository(fetchImpl).list(SESSION, 'g1');
    assert.deepEqual(result.months.map((m) => m.status), ['open', 'skipped', 'unsettled', 'settled']);
  });

  it('知らない状態（サーバーが足した値）は unknown。一覧全体を失敗にしない', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, {
        currentMonth: '2026-11',
        months: [
          { month: '2026-10', status: 'archived' },
          { month: '2026-11', status: 'open' },
        ],
      }),
    );
    const result = await createMonthRepository(fetchImpl).list(SESSION, 'g1');
    assert.deepEqual(result.months, [
      { month: '2026-10', status: 'unknown' },
      { month: '2026-11', status: 'open' },
    ]);
  });

  it('形の違う応答は invalid-response', async () => {
    const bodies = [
      {},
      null,
      { currentMonth: '2026-11' },
      { currentMonth: '2026-13', months: [] },
      { currentMonth: 'x', months: [] },
      { currentMonth: '2026-11', months: {} },
      { currentMonth: '2026-11', months: [null] },
      { currentMonth: '2026-11', months: [{ month: '2026-10', status: 1 }] },
      { currentMonth: '2026-11', months: [{ month: '2026-10' }] },
      { currentMonth: '2026-11', months: [{ month: '2026-1', status: 'open' }] },
    ];
    for (const b of bodies) {
      await rejectsWith(createMonthRepository(fakeFetch(() => reply(200, b)).fetchImpl).list(SESSION, 'g1'), 'invalid-response');
    }
  });

  it('401 は unauthorized、404 は invalid-request、5xx は unavailable、通信の失敗は network', async () => {
    await rejectsWith(createMonthRepository(fakeFetch(() => reply(401)).fetchImpl).list(SESSION, 'g1'), 'unauthorized');
    await rejectsWith(createMonthRepository(fakeFetch(() => reply(404)).fetchImpl).list(SESSION, 'g1'), 'invalid-request');
    await rejectsWith(createMonthRepository(fakeFetch(() => reply(503)).fetchImpl).list(SESSION, 'g1'), 'unavailable');
    await rejectsWith(createMonthRepository(fakeFetch(() => new Error('offline')).fetchImpl).list(SESSION, 'g1'), 'network');
  });
});

describe('summary', () => {
  it('GET /groups/:id/months/:month/summary を呼び、見込みを読む（送金にIDも状態も無い）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, estimate));
    const view = await createMonthRepository(fetchImpl).summary(SESSION, 'g1', '2026-11');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/months/2026-11/summary`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(view.closed, false);
    assert.equal(view.closing, null);
    assert.equal(view.totalMinor, 14000);
    assert.deepEqual(view.transfers, [{ kind: 'estimate', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 3000 }]);
    assert.deepEqual(view.close, { closable: false, reason: 'previous_month_not_closed', month: '2026-10' });
    assert.deepEqual(view.members[0], monthMember);
    assert.deepEqual(view.categories[0], { categoryId: 'c1', totalMinor: 14000, burdens: [{ memberId: 'm1', burdenMinor: 7000 }] });
  });

  it('締めた月は、送金ごとに状態を読む', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, closedView));
    const view = await createMonthRepository(fetchImpl).summary(SESSION, 'g1', '2026-10');
    assert.equal(view.closed, true);
    assert.deepEqual(view.closing, { id: 'cl1', closedAt: 1790000000000, closedByMemberId: 'm1', processed: false });
    assert.deepEqual(view.transfers, [
      { kind: 'closed', id: 't1', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 3000, status: 'pending', canCarry: true },
    ]);
    assert.deepEqual(view.close, { closable: false, reason: 'month_closed', month: null });
  });

  it('知らない締められない理由（サーバーが足した値）は unknown。月の集計全体を失敗にしない', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { ...estimate, close: { closable: false, reason: 'maintenance' } }));
    const view = await createMonthRepository(fetchImpl).summary(SESSION, 'g1', '2026-11');
    assert.deepEqual(view.close, { closable: false, reason: 'unknown', month: null });
    assert.equal(view.totalMinor, 14000);
  });

  it('締められる月は closable: true', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { ...estimate, close: { closable: true } }));
    assert.deepEqual((await createMonthRepository(fetchImpl).summary(SESSION, 'g1', '2026-11')).close, { closable: true });
  });

  it('月を渡すときは、形を確かめる（パスに入れる値）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, estimate));
    for (const bad of ['2026-11/../x', '2026-13', '', '2026-1', '../groups']) {
      await rejectsWith(createMonthRepository(fetchImpl).summary(SESSION, 'g1', bad), 'invalid-response');
    }
    assert.equal(calls.length, 0);
  });

  it('別の月の結果が返ったら invalid-response（その月の画面に出さない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { ...estimate, month: '2026-10' }));
    await rejectsWith(createMonthRepository(fetchImpl).summary(SESSION, 'g1', '2026-11'), 'invalid-response');
  });

  it('形の違う応答は invalid-response', async () => {
    const bodies = [
      null,
      {},
      { ...estimate, totalMinor: '14000' },
      { ...estimate, totalMinor: 1.5 },
      { ...estimate, closed: 'no' },
      { ...estimate, members: [{ ...monthMember, netMinor: undefined }] },
      { ...estimate, members: {} },
      { ...estimate, categories: [{ categoryId: 'c1', totalMinor: 1, burdens: [null] }] },
      { ...estimate, transfers: [{ fromMemberId: 'm2' }] },
      { ...estimate, close: null },
      { ...estimate, close: { closable: false } },
      { ...estimate, close: { closable: false, reason: 1 } },
      { ...estimate, close: { closable: false, reason: 'previous_month_not_closed', month: 'x' } },
      { ...closedView, closing: null, transfers: closedView.transfers },
      { ...closedView, closing: { id: 'cl1' } },
      { ...closedView, transfers: [{ ...closedView.transfers[0], status: 'weird' }] },
      { ...closedView, transfers: [{ ...closedView.transfers[0], id: undefined }] },
      { ...closedView, transfers: [{ ...closedView.transfers[0], canCarry: 'yes' }] },
    ];
    for (const b of bodies) {
      const requested = b !== null && typeof b === 'object' && 'month' in b && b.month === '2026-10' ? '2026-10' : '2026-11';
      await rejectsWith(
        createMonthRepository(fakeFetch(() => reply(200, b)).fetchImpl).summary(SESSION, 'g1', requested),
        'invalid-response',
      );
    }
  });

  it('403・404・409 は invalid-request、401 は unauthorized、5xx は unavailable', async () => {
    for (const status of [403, 404, 409]) {
      await rejectsWith(createMonthRepository(fakeFetch(() => reply(status)).fetchImpl).summary(SESSION, 'g1', '2026-11'), 'invalid-request');
    }
    await rejectsWith(createMonthRepository(fakeFetch(() => reply(401)).fetchImpl).summary(SESSION, 'g1', '2026-11'), 'unauthorized');
    await rejectsWith(createMonthRepository(fakeFetch(() => reply(500)).fetchImpl).summary(SESSION, 'g1', '2026-11'), 'unavailable');
  });
});
