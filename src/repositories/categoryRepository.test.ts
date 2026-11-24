// 費目の一覧・作成・変更・並べ替えのHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は docs/backend-design.md 9章の
// 「費目・負担割合API」と worker/src/categories.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { CategoryRejectedError, createCategoryRepository, type CategoryFetchLike } from './categoryRepository.ts';

type Init = Parameters<CategoryFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<CategoryFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: CategoryFetchLike = async (url, init) => {
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
const category = { id: 'c1', name: '食費', icon: 'cart', color: 'green', sortOrder: 1, archivedAt: null };

describe('list', () => {
  it('GET /groups/:id/categories を呼び、費目を読む（アーカイブしたものも）', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      reply(200, { categories: [category, { ...category, id: 'c2', name: '昔の費目', sortOrder: 2, archivedAt: 1790000000000 }] }),
    );
    const result = await createCategoryRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/categories`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.deepEqual(result, [
      { id: 'c1', name: '食費', icon: 'cart', color: 'green', sortOrder: 1, archived: false },
      { id: 'c2', name: '昔の費目', icon: 'cart', color: 'green', sortOrder: 2, archived: true },
    ]);
  });

  it('知らないアイコン・色のキーも、そのまま読む（見た目は画面が既定にする）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { categories: [{ ...category, icon: 'rocket', color: 'magenta' }] }));
    const [row] = await createCategoryRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(row?.icon, 'rocket');
    assert.equal(row?.color, 'magenta');
  });

  it('形の違う応答は invalid-response', async () => {
    const bad = [
      null,
      {},
      { categories: {} },
      { categories: [null] },
      { categories: [{ ...category, name: 1 }] },
      { categories: [{ ...category, sortOrder: '1' }] },
      { categories: [{ ...category, archivedAt: 'yesterday' }] },
      { categories: [{ ...category, archivedAt: undefined }] },
      { categories: [{ ...category, id: '' }] },
    ];
    for (const b of bad) {
      await rejectsWith(createCategoryRepository(fakeFetch(() => reply(200, b)).fetchImpl).list(SESSION, 'g1'), 'invalid-response');
    }
  });

  it('401 は unauthorized、404 は invalid-request、5xx は unavailable、通信の失敗は network', async () => {
    const list = (fetchImpl: CategoryFetchLike) => createCategoryRepository(fetchImpl).list(SESSION, 'g1');
    await rejectsWith(list(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(list(fakeFetch(() => reply(404)).fetchImpl), 'invalid-request');
    await rejectsWith(list(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(list(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

const UUID = '0b0c1d2e-3f40-4152-8364-758697a8b9ca';

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

describe('create', () => {
  it('POST /groups/:id/categories を、id・name・icon・color で送る。作成した費目の id を返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, { category }));
    const result = await createCategoryRepository(fetchImpl).create(SESSION, 'g/1', {
      id: UUID,
      name: '食費',
      icon: 'cart',
      color: 'green',
    });
    assert.deepEqual(result, { id: 'c1' });
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g%2F1/categories`);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { id: UUID, name: '食費', icon: 'cart', color: 'green' });
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  });

  it('同じ id の再送（200）も成功。使うのは category.id だけで、ほかの項目が崩れていても成功にする', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { category: { id: 'c1', name: 5, sortOrder: 'x' } }));
    const input = { id: UUID, name: '食費', icon: 'cart', color: 'green' };
    assert.deepEqual(await createCategoryRepository(fetchImpl).create(SESSION, 'g1', input), { id: 'c1' });
  });

  it('費目のIDを読めない応答（JSONでない200など）は invalid-response', async () => {
    const input = { id: UUID, name: '食費', icon: 'cart', color: 'green' };
    for (const body of [null, {}, [], 'ok', { category: null }, { category: {} }, { category: { id: '' } }]) {
      await rejectsWith(createCategoryRepository(fakeFetch(() => reply(201, body)).fetchImpl).create(SESSION, 'g1', input), 'invalid-response');
    }
  });

  it('費目が上限（409 too_many_categories）・IDが他のグループのもの（409 conflict）は、理由つきで断る', async () => {
    const input = { id: UUID, name: '食費', icon: 'cart', color: 'green' };
    const tooMany = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(409, { error: 'too_many_categories' })).fetchImpl).create(SESSION, 'g1', input),
    );
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.reason, 'too_many_categories');
    const conflict = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(409, { error: 'conflict' })).fetchImpl).create(SESSION, 'g1', input),
    );
    assert.equal(conflict.reason, 'conflict');
  });

  it('400 は、直すべき項目の名前を載せる', async () => {
    const input = { id: UUID, name: '', icon: 'cart', color: 'green' };
    const error = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(400, { error: 'invalid_request', field: 'name' })).fetchImpl).create(SESSION, 'g1', input),
    );
    assert.equal(error.status, 400);
    assert.equal(error.field, 'name');
  });

  it('断りの本文が読めなくても invalid-request（理由なし）。401・5xx・通信の失敗は、それぞれの種類', async () => {
    const input = { id: UUID, name: '食費', icon: 'cart', color: 'green' };
    const create = (fetchImpl: CategoryFetchLike) => createCategoryRepository(fetchImpl).create(SESSION, 'g1', input);
    // 本文が読めないとき（JSONでない409など）は、`CategoryRejectedError`（理由つき）ではなく、汎用の invalid-request になる（`apiClient.ts`）
    const unreadable = fakeFetch(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.reject(new Error('html')) }));
    await assert.rejects(
      create(unreadable.fetchImpl),
      (error) => error instanceof AuthError && error.code === 'invalid-request' && !(error instanceof CategoryRejectedError),
    );
    await rejectsWith(create(fakeFetch(() => reply(401)).fetchImpl), 'unauthorized');
    await rejectsWith(create(fakeFetch(() => reply(503)).fetchImpl), 'unavailable');
    await rejectsWith(create(fakeFetch(() => new Error('offline')).fetchImpl), 'network');
  });
});

describe('update', () => {
  it('PATCH /categories/:id に、変えるものだけを送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { category }));
    const result = await createCategoryRepository(fetchImpl).update(SESSION, 'c/1', { name: '外食' });
    assert.deepEqual(result, { id: 'c1' });
    assert.equal(calls[0].url, `${API_ORIGIN}/categories/c%2F1`);
    assert.equal(calls[0].init.method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { name: '外食' });
  });

  it('アーカイブ（archived: true）と戻す（archived: false）。false も送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { category }));
    await createCategoryRepository(fetchImpl).update(SESSION, 'c1', { archived: true });
    await createCategoryRepository(fetchImpl).update(SESSION, 'c1', { archived: false });
    await createCategoryRepository(fetchImpl).update(SESSION, 'c1', { icon: 'home', color: 'blue' });
    assert.deepEqual(JSON.parse(calls[0].init.body!), { archived: true });
    assert.deepEqual(JSON.parse(calls[1].init.body!), { archived: false });
    assert.deepEqual(JSON.parse(calls[2].init.body!), { icon: 'home', color: 'blue' });
  });

  it('断られたら、理由を載せる（404 は、費目が無い・他のグループのID・脱退済みを区別しない）', async () => {
    const forbidden = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(403, { error: 'forbidden' })).fetchImpl).update(SESSION, 'c1', { name: 'x' }),
    );
    assert.equal(forbidden.reason, 'forbidden');
    const notFound = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(404, { error: 'not_found' })).fetchImpl).update(SESSION, 'c1', { name: 'x' }),
    );
    assert.equal(notFound.status, 404);
    assert.equal(notFound.reason, 'not_found');
  });

  it('費目のIDを読めない応答は invalid-response', async () => {
    await rejectsWith(
      createCategoryRepository(fakeFetch(() => reply(200, { category: {} })).fetchImpl).update(SESSION, 'c1', { name: 'x' }),
      'invalid-response',
    );
  });
});

describe('reorder', () => {
  it('PUT /groups/:id/categories/order に、全費目のIDを並べたい順に送る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { categories: [category] }));
    await createCategoryRepository(fetchImpl).reorder(SESSION, 'g1', ['c2', 'c1', 'c3']);
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/categories/order`);
    assert.equal(calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].init.body!), { categoryIds: ['c2', 'c1', 'c3'] });
  });

  it('応答の費目は読まない（配列であることだけ確かめる）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { categories: [{ junk: true }] }));
    await createCategoryRepository(fetchImpl).reorder(SESSION, 'g1', ['c1']);
    for (const body of [null, {}, { categories: 'x' }, []]) {
      await rejectsWith(createCategoryRepository(fakeFetch(() => reply(200, body)).fetchImpl).reorder(SESSION, 'g1', ['c1']), 'invalid-response');
    }
  });

  it('全費目と合わない（409 categories_changed）は、理由つきで断る', async () => {
    const error = await rejectedWith(
      createCategoryRepository(fakeFetch(() => reply(409, { error: 'categories_changed' })).fetchImpl).reorder(SESSION, 'g1', ['c1']),
    );
    assert.equal(error.reason, 'categories_changed');
  });
});
