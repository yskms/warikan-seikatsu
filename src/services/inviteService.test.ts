// メンバーと招待のServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通すこと（セッション喪失の通知の配線は、
// その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail } from '../domain/group.ts';
import type { Invite } from '../domain/invite.ts';
import { AuthError } from '../repositories/authError.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { InviteRepository } from '../repositories/inviteRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createInviteService } from './inviteService.ts';

const group = { id: 'g1' } as GroupDetail;
const inviteList: Invite[] = [{ id: 'i1', expiresAt: 2, createdAt: 1 }];

function setup(options: { session?: string; failWith?: Error } = {}) {
  const log: string[] = [];
  const groups = {
    async get(session: string, groupId: string) {
      log.push(`group:${session}:${groupId}`);
      return group;
    },
  } as unknown as GroupRepository;
  const invites = {
    async list(session: string, groupId: string) {
      log.push(`list:${session}:${groupId}`);
      return inviteList;
    },
    async create(session: string, groupId: string) {
      log.push(`create:${session}:${groupId}`);
      return { id: 'i2', token: 'T'.repeat(43) };
    },
    async revoke(session: string, inviteId: string) {
      log.push(`revoke:${session}:${inviteId}`);
    },
    async preview(session: string, token: string) {
      log.push(`preview:${session}:${token}`);
      return { alreadyMember: false, groupName: 'g', invitedByDisplayName: 'i', groupFull: false };
    },
    async join(session: string, token: string, displayName: string) {
      log.push(`join:${session}:${token}:${displayName}`);
      return { groupId: 'g1' };
    },
  } as unknown as InviteRepository;
  let withSessionCalls = 0;
  const access: SessionAccess = {
    async withSession(operation) {
      withSessionCalls += 1;
      if (options.failWith) throw options.failWith;
      return operation(options.session ?? 'S1');
    },
  };
  return { service: createInviteService({ groups, invites, access }), log, withSessionCalls: () => withSessionCalls };
}

describe('load', () => {
  it('グループと招待の一覧を、1回の withSession の中で読む', async () => {
    const { service, log, withSessionCalls } = setup();
    const data = await service.load('g1');
    assert.equal(data.group, group);
    assert.equal(data.invites, inviteList);
    assert.deepEqual([...log].sort(), ['group:S1:g1', 'list:S1:g1']);
    assert.equal(withSessionCalls(), 1);
  });

  it('どちらかが失敗したら、失敗する（半端な画面にしない）', async () => {
    const groups = {
      async get() {
        throw new AuthError('network');
      },
    } as unknown as GroupRepository;
    const invites = {
      async list() {
        return inviteList;
      },
    } as unknown as InviteRepository;
    const access: SessionAccess = { withSession: (operation) => operation('S1') };
    await assert.rejects(createInviteService({ groups, invites, access }).load('g1'), (e) => e instanceof AuthError && e.code === 'network');
  });
});

describe('issue・revoke', () => {
  it('発行は、トークンを含む結果をそのまま返す', async () => {
    const { service, log, withSessionCalls } = setup();
    assert.deepEqual(await service.issue('g1'), { id: 'i2', token: 'T'.repeat(43) });
    assert.deepEqual(log, ['create:S1:g1']);
    assert.equal(withSessionCalls(), 1);
  });

  it('取り消しは、招待のIDで呼ぶ', async () => {
    const { service, log, withSessionCalls } = setup();
    await service.revoke('i1');
    assert.deepEqual(log, ['revoke:S1:i1']);
    assert.equal(withSessionCalls(), 1);
  });
});

describe('preview・join（招待を開いて参加する側）', () => {
  it('内容の確認は、トークンで呼ぶ', async () => {
    const { service, log, withSessionCalls } = setup();
    assert.deepEqual(await service.preview('T1'), {
      alreadyMember: false,
      groupName: 'g',
      invitedByDisplayName: 'i',
      groupFull: false,
    });
    assert.deepEqual(log, ['preview:S1:T1']);
    assert.equal(withSessionCalls(), 1);
  });

  it('参加は、トークンと表示名で呼ぶ', async () => {
    const { service, log, withSessionCalls } = setup();
    assert.deepEqual(await service.join('T1', 'はなこ'), { groupId: 'g1' });
    assert.deepEqual(log, ['join:S1:T1:はなこ']);
    assert.equal(withSessionCalls(), 1);
  });
});

describe('セッションが無いとき', () => {
  it('どの呼び出しも、withSession の失敗をそのまま画面へ届ける（Repositoryは呼ばない）', async () => {
    const { service, log } = setup({ failWith: new AuthError('not-signed-in') });
    await assert.rejects(service.load('g1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.issue('g1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.revoke('i1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.preview('T1'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    await assert.rejects(service.join('T1', 'はなこ'), (e) => e instanceof AuthError && e.code === 'not-signed-in');
    assert.deepEqual(log, []);
  });
});
