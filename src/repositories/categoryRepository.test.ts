// 費目の一覧のHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は docs/backend-design.md 9章の
// 「費目・負担割合API」と worker/src/categories.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createCategoryRepository, type CategoryFetchLike } from './categoryRepository.ts';

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
