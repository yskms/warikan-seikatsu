// グループのServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通ること（セッション喪失の通知の
// 配線は、その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Group, GroupListItem } from '../domain/group.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CreateGroupRequest, GroupRepository } from '../repositories/groupRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createGroupService } from './groupService.ts';

const item = { id: 'g1' } as GroupListItem;
const group = { id: 'g1' } as Group;
const request: CreateGroupRequest = {
  id: '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b',
  name: 'ふたりの生活費',
  displayName: 'あなた',
  currencyCode: 'JPY',
  timezone: 'Asia/Tokyo',
};

function setup(options: { session?: string; failWith?: Error } = {}) {
  const log: string[] = [];
  const groups = {
    async list(session: string) {
      log.push(`list:${session}`);
      return [item];
    },
    async create(session: string, req: CreateGroupRequest) {
      log.push(`create:${session}:${req.id}`);
      return group;
    },
  } as unknown as GroupRepository;
  const access: SessionAccess = {
    async withSession(task) {
      log.push('withSession');
      if (options.failWith) throw options.failWith;
      return task(options.session ?? 'S');
    },
  };
  return { service: createGroupService({ groups, access }), log };
}

describe('groupService', () => {
  it('listGroups は withSession を通して、セッションを Repository に渡す', async () => {
    const { service, log } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.listGroups(), [item]);
    assert.deepEqual(log, ['withSession', 'list:SESSION']);
  });

  it('createGroup は withSession を通して、id ごと Repository に渡す', async () => {
    const { service, log } = setup({ session: 'SESSION' });
    assert.equal(await service.createGroup(request), group);
    assert.deepEqual(log, ['withSession', `create:SESSION:${request.id}`]);
  });

  it('サインインしていない（withSession の失敗）は、そのまま投げる。Repository は呼ばない', async () => {
    const { service, log } = setup({ failWith: new AuthError('not-signed-in') });
    await assert.rejects(service.listGroups(), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.createGroup(request), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    assert.deepEqual(log, ['withSession', 'withSession']);
  });
});
