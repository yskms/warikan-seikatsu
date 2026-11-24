// グループのServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通ること（セッション喪失の通知の
// 配線は、その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupListItem } from '../domain/group.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CreateGroupRequest, GroupRepository } from '../repositories/groupRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createGroupService } from './groupService.ts';

const item = { id: 'g1' } as GroupListItem;
const created = { id: 'g1' };
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
      return created;
    },
    async requestLeave(session: string, groupId: string, acknowledgeDelete = false) {
      log.push(`requestLeave:${session}:${groupId}${acknowledgeDelete ? ':ack' : ''}`);
      return { confirmed: false, groupDeleted: false };
    },
    async cancelLeave(session: string, groupId: string) {
      log.push(`cancelLeave:${session}:${groupId}`);
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
    assert.deepEqual(await service.createGroup(request), created);
    assert.deepEqual(log, ['withSession', `create:SESSION:${request.id}`]);
  });

  it('requestLeave・cancelLeave は withSession を通して、セッションとグループのIDを Repository に渡す', async () => {
    const { service, log } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.requestLeave('g1'), { confirmed: false, groupDeleted: false });
    await service.cancelLeave('g1');
    assert.deepEqual(log, ['withSession', 'requestLeave:SESSION:g1', 'withSession', 'cancelLeave:SESSION:g1']);
  });

  it('requestLeave の確認の申告（acknowledgeDelete）は、そのまま Repository へ渡す。既定は、申告なし', async () => {
    const { service, log } = setup({ session: 'SESSION' });
    await service.requestLeave('g1', true);
    await service.requestLeave('g1');
    assert.deepEqual(log.filter((entry) => entry.startsWith('requestLeave:')), ['requestLeave:SESSION:g1:ack', 'requestLeave:SESSION:g1']);
  });

  it('サインインしていない（withSession の失敗）は、そのまま投げる。Repository は呼ばない', async () => {
    const { service, log } = setup({ failWith: new AuthError('not-signed-in') });
    await assert.rejects(service.listGroups(), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.createGroup(request), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.requestLeave('g1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.cancelLeave('g1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    assert.deepEqual(log, ['withSession', 'withSession', 'withSession', 'withSession']);
  });
});
