// 月ごとの費目の負担割合のHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は
// docs/backend-design.md 9章の「費目・負担割合API」と worker/src/categories.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { CategoryRejectedError } from './categoryRepository.ts';
import { createCategorySharesRepository, type CategorySharesFetchLike } from './categorySharesRepository.ts';

type Init = Parameters<CategorySharesFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<CategorySharesFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: CategorySharesFetchLike = async (url, init) => {
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

async function rejectedWith(promise: Promise<unknown>): Promise<CategoryRejectedError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CategoryRejectedError, 'CategoryRejectedError が投げられる');
    assert.equal(error.code, 'invalid-request');
    return error;
  }
  throw new assert.AssertionError({ message: '失敗するはずが、成功した' });
}

const SESSION = 'A'.repeat(43);

const rule = {
  categoryId: 'c1',
  sourceMonth: '2026-10',
  shares: [
    { memberId: 'm1', basisPoints: 7000 },
    { memberId: 'm2', basisPoints: 3000 },
  ],
  cap: null,
  archived: false,
  memberChangedAt: null,
};
const sharesBody = { month: '2026-11', closed: false, editable: true, memberIds: ['m1', 'm2'], categories: [rule] };

describe('get', () => {
  it('GET /groups/:id/months/:month/category-shares を呼び、割合を読む', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, sharesBody));
    const result = await createCategorySharesRepository(fetchImpl).get(SESSION, 'g/1', '2026-11');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g%2F1/months/2026-11/category-shares`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.deepEqual(result, {
      month: '2026-11',
      closed: false,
      editable: true,
      memberIds: ['m1', 'm2'],
      categories: [rule],
    });
  });

  it('上限額つきの割合と、アーカイブした費目を読む', async () => {
    const capped = {
      ...rule,
      categoryId: 'c2',
      shares: [
        { memberId: 'm1', basisPoints: 0 },
        { memberId: 'm2', basisPoints: 10000 },
      ],
      cap: { memberId: 'm1', capMinor: 10000 },
      archived: true,
    };
    const { fetchImpl } = fakeFetch(() => reply(200, { ...sharesBody, categories: [capped] }));
    const result = await createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-11');
    assert.deepEqual(result.categories, [capped]);
  });

  it('メンバーの増減で戻した印（memberChangedAt）は、時刻のまま読む', async () => {
    const marked = { ...rule, memberChangedAt: 1_795_057_200_000 };
    const { fetchImpl } = fakeFetch(() => reply(200, { ...sharesBody, categories: [marked] }));
    const result = await createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-11');
    assert.equal(result.categories[0]?.memberChangedAt, 1_795_057_200_000);
  });

  it('割合が1つも無い月（費目が空）も読める', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { ...sharesBody, categories: [] }));
    assert.deepEqual((await createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-11')).categories, []);
  });

  it('形の違う応答は invalid-response（読み込みなので、全項目を検べる）', async () => {
    const bad = [
      null,
      {},
      { ...sharesBody, month: 'next' },
      { ...sharesBody, closed: 'no' },
      { ...sharesBody, editable: undefined },
      { ...sharesBody, memberIds: 'm1' },
      { ...sharesBody, memberIds: [''] },
      { ...sharesBody, categories: {} },
      { ...sharesBody, categories: [{ ...rule, categoryId: '' }] },
      { ...sharesBody, categories: [{ ...rule, sourceMonth: '2026-13' }] },
      { ...sharesBody, categories: [{ ...rule, shares: [{ memberId: 'm1', basisPoints: '7000' }] }] },
      { ...sharesBody, categories: [{ ...rule, shares: [{ memberId: 'm1', basisPoints: 70.5 }] }] },
      { ...sharesBody, categories: [{ ...rule, cap: { memberId: 'm1' } }] },
      { ...sharesBody, categories: [{ ...rule, cap: undefined }] },
      { ...sharesBody, categories: [{ ...rule, archived: 'false' }] },
      { ...sharesBody, categories: [{ ...rule, memberChangedAt: undefined }] },
      { ...sharesBody, categories: [{ ...rule, memberChangedAt: '1000' }] },
      { ...sharesBody, categories: [{ ...rule, memberChangedAt: 1.5 }] },
    ];
    for (const body of bad) {
      await rejectsWith(
        createCategorySharesRepository(fakeFetch(() => reply(200, body)).fetchImpl).get(SESSION, 'g1', '2026-11'),
        'invalid-response',
      );
    }
  });

  it('別の月の結果が返ったら invalid-response（その月の画面に出さない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { ...sharesBody, month: '2026-10' }));
    await rejectsWith(createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-11'), 'invalid-response');
  });

  it('月の形が違えば、送らずに invalid-response（パスに入れる前に検べる）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, sharesBody));
    await rejectsWith(createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-13'), 'invalid-response');
    await rejectsWith(createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '../x'), 'invalid-response');
    assert.equal(calls.length, 0);
  });

  it('401 は unauthorized、403・404 は invalid-request、5xx は unavailable、通信の失敗は network', async () => {
    const get = (fetchImpl: CategorySharesFetchLike) => createCategorySharesRepository(fetchImpl).get(SESSION, 'g1', '2026-11');
    await rejectsWith(get(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(get(fakeFetch(() => reply(403)).fetchImpl), 'invalid-request');
    await rejectsWith(get(fakeFetch(() => reply(404)).fetchImpl), 'invalid-request');
    await rejectsWith(get(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(get(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

describe('put', () => {
  const input = {
    shares: [
      { memberId: 'm1', basisPoints: 6000 },
      { memberId: 'm2', basisPoints: 4000 },
    ],
    cap: null,
    currencyCode: null,
  };

  it('PUT .../category-shares/:categoryId に、割合を送る。上限なしなら cap・currencyCode は送らない', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { month: '2026-11', rule, overriddenMonths: [] }));
    const result = await createCategorySharesRepository(fetchImpl).put(SESSION, 'g/1', '2026-11', 'c/1', input);
    assert.deepEqual(result, { overriddenMonths: [] });
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g%2F1/months/2026-11/category-shares/c%2F1`);
    assert.equal(calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].init.body!), {
      shares: [
        { memberId: 'm1', basisPoints: 6000 },
        { memberId: 'm2', basisPoints: 4000 },
      ],
    });
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  });

  it('上限額つきなら、cap と currencyCode を送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { month: '2026-11', rule, overriddenMonths: [] }));
    await createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', {
      shares: [
        { memberId: 'm1', basisPoints: 0 },
        { memberId: 'm2', basisPoints: 10000 },
      ],
      cap: { memberId: 'm1', capMinor: 10000 },
      currencyCode: 'JPY',
    });
    assert.deepEqual(JSON.parse(calls[0].init.body!), {
      shares: [
        { memberId: 'm1', basisPoints: 0 },
        { memberId: 'm2', basisPoints: 10000 },
      ],
      cap: { memberId: 'm1', capMinor: 10000 },
      currencyCode: 'JPY',
    });
  });

  it('後の月に別の設定があれば、overriddenMonths で返る', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { month: '2026-11', rule, overriddenMonths: ['2027-01', '2027-03'] }));
    const result = await createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input);
    assert.deepEqual(result, { overriddenMonths: ['2027-01', '2027-03'] });
  });

  it('使うのは overriddenMonths だけ。rule が崩れていても、保存は済んでいるので成功にする', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { rule: 'x', overriddenMonths: ['2027-01'] }));
    assert.deepEqual(await createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input), {
      overriddenMonths: ['2027-01'],
    });
  });

  it('overriddenMonths が読めなくても、成功（案内する月なし）。形の違う月は捨てる', async () => {
    for (const body of [{}, { overriddenMonths: 'x' }, { overriddenMonths: null }]) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      assert.deepEqual(await createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input), {
        overriddenMonths: [],
      });
    }
    const { fetchImpl } = fakeFetch(() => reply(200, { overriddenMonths: ['2027-01', 5, '2027-13', 'x'] }));
    assert.deepEqual(await createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input), {
      overriddenMonths: ['2027-01'],
    });
  });

  it('JSONでない200（オブジェクトでない応答）は invalid-response', async () => {
    for (const body of [null, 'ok', []]) {
      await rejectsWith(
        createCategorySharesRepository(fakeFetch(() => reply(200, body)).fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input),
        'invalid-response',
      );
    }
  });

  it('月の形が違えば、送らずに invalid-response', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, {}));
    await rejectsWith(createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-13', 'c1', input), 'invalid-response');
    assert.equal(calls.length, 0);
  });

  it('締めた月（409 month_closed）は、理由つきで断る', async () => {
    const error = await rejectedWith(
      createCategorySharesRepository(fakeFetch(() => reply(409, { error: 'month_closed' })).fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input),
    );
    assert.equal(error.status, 409);
    assert.equal(error.reason, 'month_closed');
  });

  it('直せる月の範囲外（409 month_not_editable）は、範囲を載せる', async () => {
    const error = await rejectedWith(
      createCategorySharesRepository(
        fakeFetch(() => reply(409, { error: 'month_not_editable', from: '2026-10', to: '2026-11' })).fetchImpl,
      ).put(SESSION, 'g1', '2027-05', 'c1', input),
    );
    assert.equal(error.reason, 'month_not_editable');
    assert.equal(error.from, '2026-10');
    assert.equal(error.to, '2026-11');
  });

  it('メンバーが変わった（409 members_changed）は、いま必要なメンバーを載せる', async () => {
    const error = await rejectedWith(
      createCategorySharesRepository(
        fakeFetch(() => reply(409, { error: 'members_changed', memberIds: ['m1', 'm2', 'm3'] })).fetchImpl,
      ).put(SESSION, 'g1', '2026-11', 'c1', input),
    );
    assert.equal(error.reason, 'members_changed');
    assert.deepEqual(error.memberIds, ['m1', 'm2', 'm3']);
  });

  it('形の違う範囲・メンバーは、載せない（理由だけ）', async () => {
    const error = await rejectedWith(
      createCategorySharesRepository(
        fakeFetch(() => reply(409, { error: 'members_changed', memberIds: ['m1', 5], from: 'x', to: 7 })).fetchImpl,
      ).put(SESSION, 'g1', '2026-11', 'c1', input),
    );
    assert.equal(error.reason, 'members_changed');
    assert.equal(error.memberIds, null);
    assert.equal(error.from, null);
    assert.equal(error.to, null);
  });

  it('割合の形が違う（400 shares）は、直すべき項目を載せる。上限の通貨違い（409 currency_mismatch）は理由', async () => {
    const bad = await rejectedWith(
      createCategorySharesRepository(fakeFetch(() => reply(400, { error: 'invalid_request', field: 'shares' })).fetchImpl).put(
        SESSION,
        'g1',
        '2026-11',
        'c1',
        input,
      ),
    );
    assert.equal(bad.field, 'shares');
    const mismatch = await rejectedWith(
      createCategorySharesRepository(fakeFetch(() => reply(409, { error: 'currency_mismatch', currencyCode: 'USD' })).fetchImpl).put(
        SESSION,
        'g1',
        '2026-11',
        'c1',
        input,
      ),
    );
    assert.equal(mismatch.reason, 'currency_mismatch');
  });

  it('401 は unauthorized、5xx は unavailable、通信の失敗は network', async () => {
    const put = (fetchImpl: CategorySharesFetchLike) =>
      createCategorySharesRepository(fetchImpl).put(SESSION, 'g1', '2026-11', 'c1', input);
    await rejectsWith(put(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(put(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(put(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

describe('acknowledgeReset', () => {
  it('POST /groups/:id/category-shares/acknowledge-reset に、through を送る。204の本文は読まない', async () => {
    const { fetchImpl, calls } = fakeFetch(() => Promise.resolve({ ok: true, status: 204, json: async () => Promise.reject(new Error('no body')) }));
    const result = await createCategorySharesRepository(fetchImpl).acknowledgeReset(SESSION, 'g/1', 1_795_057_200_000);
    assert.equal(result, undefined);
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g%2F1/category-shares/acknowledge-reset`);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { through: 1_795_057_200_000 });
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  });

  it('断られたら、理由つき。脱退が確定した人（403）・メンバーでない（404）・競合（409）', async () => {
    for (const [status, reason] of [
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
    ] as const) {
      const error = await rejectedWith(
        createCategorySharesRepository(fakeFetch(() => reply(status, { error: reason })).fetchImpl).acknowledgeReset(SESSION, 'g1', 1),
      );
      assert.equal(error.status, status);
      assert.equal(error.reason, reason);
    }
  });

  it('401 は unauthorized、5xx は unavailable、通信の失敗は network', async () => {
    const send = (fetchImpl: CategorySharesFetchLike) => createCategorySharesRepository(fetchImpl).acknowledgeReset(SESSION, 'g1', 1);
    await rejectsWith(send(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(send(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(send(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});
