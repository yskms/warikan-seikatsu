// 招待の発行・一覧・取り消しのHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かす（応答の形は docs/backend-design.md 9章の
// 「招待・参加・脱退API」と worker/src/invites.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createInviteRepository, InviteRejectedError, type InviteFetchLike } from './inviteRepository.ts';

type Init = Parameters<InviteFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<InviteFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: InviteFetchLike = async (url, init) => {
    calls.push({ url, init });
    const result = respond(url, init);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetchImpl, calls };
}

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

/** 本文を読むと失敗する応答（204は本文が無い。読んでいないことを確かめる） */
const noBody = (status: number) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async (): Promise<unknown> => {
      throw new Error('本文は読まない');
    },
  });

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof AuthError && error.code === code);
}

const SESSION = 'A'.repeat(43);
const TOKEN = 'T'.repeat(43);

describe('create', () => {
  it('POST /groups/:id/invites を呼び、招待のIDとトークンを読む', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      reply(201, { invite: { id: 'i1', token: TOKEN, expiresAt: 1790259200000, createdAt: 1790000000000 } }),
    );
    const result = await createInviteRepository(fetchImpl).create(SESSION, 'g1');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/invites`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.equal(calls[0].init.body, undefined);
    assert.deepEqual(result, { id: 'i1', token: TOKEN });
  });

  it('グループのIDは、URLの部品として符号化する', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, { invite: { id: 'i1', token: TOKEN } }));
    await createInviteRepository(fetchImpl).create(SESSION, 'a/b?c');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/a%2Fb%3Fc/invites`);
  });

  it('書き込みの応答は、使う項目（IDとトークン）だけを検べる（期限などが欠けても成功）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(201, { invite: { id: 'i1', token: TOKEN, expiresAt: 'あした' } }));
    assert.deepEqual(await createInviteRepository(fetchImpl).create(SESSION, 'g1'), { id: 'i1', token: TOKEN });
  });

  it('IDやトークンが読めない応答は invalid-response（トークンはURLに載せるので、URLに使えない文字は受けない）', async () => {
    const bad = [
      null,
      {},
      { invite: null },
      { invite: { token: TOKEN } },
      { invite: { id: 'i1' } },
      { invite: { id: 'i1', token: 1 } },
      { invite: { id: 'i1', token: '' } },
      { invite: { id: 'i1', token: 'a/b' } },
      { invite: { id: 'i1', token: 'a b' } },
      { invite: { id: 'i1', token: 'あ'.repeat(10) } },
      { invite: { id: 'i1', token: 'T'.repeat(129) } },
    ];
    for (const body of bad) {
      const { fetchImpl } = fakeFetch(() => reply(201, body));
      await rejectsWith(createInviteRepository(fetchImpl).create(SESSION, 'g1'), 'invalid-response');
    }
  });

  it('JSONでない200は invalid-response（成功と取り違えない）', async () => {
    const { fetchImpl } = fakeFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );
    await rejectsWith(createInviteRepository(fetchImpl).create(SESSION, 'g1'), 'invalid-response');
  });

  it('断られたら、InviteRejectedError に status と理由を載せる（invalid-request）', async () => {
    const cases: [number, string][] = [
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'group_full'],
      [409, 'too_many_invites'],
      [409, 'conflict'],
    ];
    for (const [status, error] of cases) {
      const { fetchImpl } = fakeFetch(() => reply(status, { error }));
      await assert.rejects(createInviteRepository(fetchImpl).create(SESSION, 'g1'), (e) => {
        assert.ok(e instanceof InviteRejectedError);
        assert.equal(e.code, 'invalid-request');
        assert.equal(e.status, status);
        assert.equal(e.reason, error);
        return true;
      });
    }
  });

  it('断りの本文が読めなくても invalid-request（理由は null）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(409, 'いいえ'));
    await assert.rejects(createInviteRepository(fetchImpl).create(SESSION, 'g1'), (e) => {
      return e instanceof InviteRejectedError && e.reason === null && e.code === 'invalid-request';
    });
    const { fetchImpl: html } = fakeFetch(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: async (): Promise<unknown> => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );
    await assert.rejects(createInviteRepository(html).create(SESSION, 'g1'), (e) => {
      return e instanceof InviteRejectedError && e.status === 403 && e.reason === null;
    });
  });

  it('401 は unauthorized、5xx・429 は unavailable、通信の失敗は network', async () => {
    const { fetchImpl: unauthorized } = fakeFetch(() => reply(401, { error: 'unauthorized' }));
    await rejectsWith(createInviteRepository(unauthorized).create(SESSION, 'g1'), 'unauthorized');
    for (const status of [429, 500, 503]) {
      const { fetchImpl } = fakeFetch(() => reply(status, { error: 'x' }));
      await rejectsWith(createInviteRepository(fetchImpl).create(SESSION, 'g1'), 'unavailable');
    }
    const { fetchImpl: down } = fakeFetch(() => new Error('offline'));
    await rejectsWith(createInviteRepository(down).create(SESSION, 'g1'), 'network');
  });
});

describe('list', () => {
  it('GET /groups/:id/invites を呼び、招待を読む', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      reply(200, {
        invites: [
          { id: 'i1', expiresAt: 1790259200000, createdAt: 1790000000000 },
          { id: 'i2', expiresAt: 1790259300000, createdAt: 1790000100000 },
        ],
      }),
    );
    const result = await createInviteRepository(fetchImpl).list(SESSION, 'g1');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1/invites`);
    assert.equal(calls[0].init.method, 'GET');
    assert.deepEqual(result, [
      { id: 'i1', expiresAt: 1790259200000, createdAt: 1790000000000 },
      { id: 'i2', expiresAt: 1790259300000, createdAt: 1790000100000 },
    ]);
  });

  it('空の一覧も読める', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { invites: [] }));
    assert.deepEqual(await createInviteRepository(fetchImpl).list(SESSION, 'g1'), []);
  });

  it('読み込みなので、形の違う応答は invalid-response', async () => {
    const bad = [
      null,
      {},
      { invites: {} },
      { invites: [{ id: 'i1' }] },
      { invites: [{ id: 'i1', expiresAt: '1', createdAt: 1 }] },
      { invites: [{ id: '', expiresAt: 1, createdAt: 1 }] },
    ];
    for (const body of bad) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createInviteRepository(fetchImpl).list(SESSION, 'g1'), 'invalid-response');
    }
  });

  it('404 は invalid-request（グループが無い・メンバーでない）', async () => {
    const { fetchImpl } = fakeFetch(() => reply(404, { error: 'not_found' }));
    await rejectsWith(createInviteRepository(fetchImpl).list(SESSION, 'g1'), 'invalid-request');
  });
});

describe('revoke', () => {
  it('DELETE /invites/:id を呼ぶ。204の本文は読まない', async () => {
    const { fetchImpl, calls } = fakeFetch(() => noBody(204));
    await createInviteRepository(fetchImpl).revoke(SESSION, 'i1');
    assert.equal(calls[0].url, `${API_ORIGIN}/invites/i1`);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
  });

  it('招待のIDは、URLの部品として符号化する', async () => {
    const { fetchImpl, calls } = fakeFetch(() => noBody(204));
    await createInviteRepository(fetchImpl).revoke(SESSION, 'a/b?c');
    assert.equal(calls[0].url, `${API_ORIGIN}/invites/a%2Fb%3Fc`);
  });

  it('使われた招待は 409 invite_already_used、無い・発行者でないは 404 not_found', async () => {
    const cases: [number, string][] = [
      [409, 'invite_already_used'],
      [404, 'not_found'],
      [409, 'conflict'],
    ];
    for (const [status, error] of cases) {
      const { fetchImpl } = fakeFetch(() => reply(status, { error }));
      await assert.rejects(createInviteRepository(fetchImpl).revoke(SESSION, 'i1'), (e) => {
        return e instanceof InviteRejectedError && e.status === status && e.reason === error && e.code === 'invalid-request';
      });
    }
  });

  it('401 は unauthorized、通信の失敗は network', async () => {
    const { fetchImpl: unauthorized } = fakeFetch(() => reply(401, { error: 'unauthorized' }));
    await rejectsWith(createInviteRepository(unauthorized).revoke(SESSION, 'i1'), 'unauthorized');
    const { fetchImpl: down } = fakeFetch(() => new Error('offline'));
    await rejectsWith(createInviteRepository(down).revoke(SESSION, 'i1'), 'network');
  });
});
