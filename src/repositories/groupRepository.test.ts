// グループのHTTPのテスト。`npm test` で実行する。偽の `fetch` で動かすので、実際のサーバーには通信しない
// （応答の形は docs/backend-design.md 9章の「グループAPI」と worker/src/groups.ts による）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_ORIGIN } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { createGroupRepository, type CreateGroupRequest, type GroupFetchLike } from './groupRepository.ts';

type Init = Parameters<GroupFetchLike>[1];

function fakeFetch(respond: (url: string, init: Init) => ReturnType<GroupFetchLike> | Error) {
  const calls: { url: string; init: Init }[] = [];
  const fetchImpl: GroupFetchLike = async (url, init) => {
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

const member = {
  id: 'm1',
  displayName: 'あなた',
  color: 'pink',
  status: 'active',
  historyFromMonth: '2026-11',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
  leaveEffective: false,
  isMe: true,
};

// `POST /groups` の応答の `group`（実際の形。アプリが読むのは `id` だけ）
const group = {
  id: 'g1',
  name: 'ふたりの生活費',
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: 1790000000000,
  memberId: 'm1',
  currencyLocked: false,
  seatedMembers: 1,
  maxMembers: 5,
  canInvite: true,
  members: [member],
};

const listItem = {
  id: 'g1',
  name: 'ふたりの生活費',
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: 1790000000000,
  memberId: 'm1',
  memberStatus: 'active',
  historyFromMonth: '2026-11',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
};

describe('list', () => {
  it('GET /groups を、セッションつきで呼び、一覧を返す（本文は送らない）', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { groups: [listItem] }));
    const groups = await createGroupRepository(fetchImpl).list(SESSION);
    assert.deepEqual(groups, [listItem]);
    assert.equal(calls[0].url, `${API_ORIGIN}/groups`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.credentials, 'omit');
  });

  it('知らない所属の状態（サーバーが足した値）は unknown。一覧全体を失敗にしない', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { groups: [{ ...listItem, memberStatus: 'suspended' }, listItem] }),
    );
    const groups = await createGroupRepository(fetchImpl).list(SESSION);
    assert.deepEqual(groups.map((g) => g.memberStatus), ['unknown', 'active']);
  });

  it('グループが無ければ空の配列', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { groups: [] }));
    assert.deepEqual(await createGroupRepository(fetchImpl).list(SESSION), []);
  });

  it('形の違う応答は invalid-response', async () => {
    const bodies = [
      {},
      null,
      { groups: {} },
      { groups: [null] },
      { groups: [{ ...listItem, memberStatus: 1 }] },
      { groups: [{ ...listItem, createdAt: 1.5 }] },
      { groups: [{ ...listItem, name: 1 }] },
      { groups: [{ ...listItem, leaveRequestedMonth: undefined }] },
      { groups: [{ ...listItem, id: '' }] },
    ];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createGroupRepository(fetchImpl).list(SESSION), 'invalid-response');
    }
  });

  it('401 は unauthorized、5xx・429 は unavailable、通信の失敗は network', async () => {
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(401)).fetchImpl).list(SESSION), 'unauthorized');
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(503)).fetchImpl).list(SESSION), 'unavailable');
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(429)).fetchImpl).list(SESSION), 'unavailable');
    await rejectsWith(createGroupRepository(fakeFetch(() => new Error('offline')).fetchImpl).list(SESSION), 'network');
  });
});

describe('get', () => {
  it('GET /groups/:id を、セッションつきで呼び、メンバーを含むグループを返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { group }));
    const detail = await createGroupRepository(fetchImpl).get(SESSION, 'g1');
    assert.deepEqual(detail, group);
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/g1`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.equal(calls[0].init.body, undefined);
  });

  it('知らないメンバーの状態（サーバーが足した値）は unknown。グループ全体を失敗にしない', async () => {
    const { fetchImpl } = fakeFetch(() =>
      reply(200, { group: { ...group, members: [{ ...member, status: 'suspended' }, member] } }),
    );
    const detail = await createGroupRepository(fetchImpl).get(SESSION, 'g1');
    assert.deepEqual(detail.members.map((m) => m.status), ['unknown', 'active']);
  });

  it('IDは、パスに入れる前に符号化する', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(200, { group }));
    await createGroupRepository(fetchImpl).get(SESSION, 'a/b?c');
    assert.equal(calls[0].url, `${API_ORIGIN}/groups/a%2Fb%3Fc`);
  });

  it('形の違う応答は invalid-response（読み込みなので、全項目を検べる）', async () => {
    const bodies = [
      {},
      null,
      { group: null },
      { group: { ...group, members: undefined } },
      { group: { ...group, members: [null] } },
      { group: { ...group, members: [{ ...member, status: 1 }] } },
      { group: { ...group, members: [{ ...member, isMe: 'yes' }] } },
      { group: { ...group, members: [{ ...member, leaveEffective: 'no' }] } },
      { group: { ...group, members: [{ ...member, leaveEffective: undefined }] } },
      { group: { ...group, currencyLocked: 'no' } },
      { group: { ...group, maxMembers: 5.5 } },
      { group: { ...group, name: 1 } },
    ];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(() => reply(200, body));
      await rejectsWith(createGroupRepository(fetchImpl).get(SESSION, 'g1'), 'invalid-response');
    }
  });

  it('404 は invalid-request（メンバーでない・抜けた・削除された。区別しない）、401 は unauthorized', async () => {
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(404)).fetchImpl).get(SESSION, 'g1'), 'invalid-request');
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(401)).fetchImpl).get(SESSION, 'g1'), 'unauthorized');
    await rejectsWith(createGroupRepository(fakeFetch(() => reply(500)).fetchImpl).get(SESSION, 'g1'), 'unavailable');
  });
});

describe('create', () => {
  const request: CreateGroupRequest = {
    id: '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b',
    name: 'ふたりの生活費',
    displayName: 'あなた',
    currencyCode: 'JPY',
    timezone: 'Asia/Tokyo',
  };

  it('POST /groups に、id・name・displayName・currencyCode・timezone を送り、作ったグループの id を返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply(201, { group }));
    const created = await createGroupRepository(fetchImpl).create(SESSION, request);
    assert.deepEqual(created, { id: 'g1' });
    assert.equal(calls[0].url, `${API_ORIGIN}/groups`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SESSION}`);
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body ?? ''), request);
  });

  it('同じ id の再送の200（保存済みのグループ）も、成功', async () => {
    const { fetchImpl } = fakeFetch(() => reply(200, { group }));
    assert.deepEqual(await createGroupRepository(fetchImpl).create(SESSION, request), { id: 'g1' });
  });

  it('id 以外の項目が足りない・増えた・型が変わっても、成功（作成は済んでいる。形のずれで失敗に見せない）', async () => {
    const groups = [
      { id: 'g1' },
      { ...group, members: undefined },
      { ...group, members: [{ status: 'unknown-status', isMe: 'yes' }], newField: { nested: true } },
      { ...group, canInvite: undefined, maxMembers: '5', createdAt: 1.5 },
    ];
    for (const g of groups) {
      const { fetchImpl } = fakeFetch(() => reply(201, { group: g }));
      assert.deepEqual(await createGroupRepository(fetchImpl).create(SESSION, request), { id: 'g1' });
    }
  });

  it('400・409 は invalid-request（本文は読まない）', async () => {
    for (const status of [400, 409]) {
      const { fetchImpl } = fakeFetch(() => reply(status, { error: 'invalid_request', field: 'name' }));
      await rejectsWith(createGroupRepository(fetchImpl).create(SESSION, request), 'invalid-request');
    }
  });

  it('group の id が読めない応答は invalid-response', async () => {
    const bodies = [{}, null, { group: null }, { group: {} }, { group: { id: '' } }, { group: { id: 1 } }, { group: { id: 'has space' } }];
    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(() => reply(201, body));
      await rejectsWith(createGroupRepository(fetchImpl).create(SESSION, request), 'invalid-response');
    }
  });

  it('401 は unauthorized、5xx は unavailable、通信の失敗は network', async () => {
    await rejectsWith(
      createGroupRepository(fakeFetch(() => reply(401)).fetchImpl).create(SESSION, request),
      'unauthorized',
    );
    await rejectsWith(
      createGroupRepository(fakeFetch(() => reply(500)).fetchImpl).create(SESSION, request),
      'unavailable',
    );
    await rejectsWith(
      createGroupRepository(fakeFetch(() => new Error('offline')).fetchImpl).create(SESSION, request),
      'network',
    );
  });

  it('エラーの message に、セッション・本文を載せない', async () => {
    const { fetchImpl } = fakeFetch(() => reply(500, { secret: 'x' }));
    await assert.rejects(createGroupRepository(fetchImpl).create(SESSION, request), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(SESSION));
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  });
});
