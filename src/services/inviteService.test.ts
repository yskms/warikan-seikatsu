// メンバーと招待のServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通すこと（セッション喪失の通知の配線は、
// その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail } from '../domain/group.ts';
import type { Invite } from '../domain/invite.ts';
import type { Category, MonthList } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { InviteRepository } from '../repositories/inviteRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createInviteService } from './inviteService.ts';

const group = { id: 'g1' } as GroupDetail;
const inviteList: Invite[] = [{ id: 'i1', expiresAt: 2, createdAt: 1 }];
const monthList: MonthList = { currentMonth: '2026-11', months: [{ month: '2026-11', status: 'open' }] };
const categoryList: Category[] = [{ id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false }];
const recurringList = [{ id: 'r1' }] as RecurringExpense[];

function setup(options: { session?: string; failWith?: Error; failRecurringWith?: Error } = {}) {
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
  const months = {
    async list(session: string, groupId: string) {
      log.push(`months:${session}:${groupId}`);
      return monthList;
    },
  } as unknown as MonthRepository;
  const categories = {
    async list(session: string, groupId: string) {
      log.push(`categories:${session}:${groupId}`);
      return categoryList;
    },
  } as unknown as CategoryRepository;
  const recurring = {
    async list(session: string, groupId: string) {
      log.push(`recurring:${session}:${groupId}`);
      if (options.failRecurringWith) throw options.failRecurringWith;
      return recurringList;
    },
  } as unknown as RecurringRepository;
  let withSessionCalls = 0;
  const access: SessionAccess = {
    async withSession(operation) {
      withSessionCalls += 1;
      if (options.failWith) throw options.failWith;
      return operation(options.session ?? 'S1');
    },
  };
  return {
    service: createInviteService({ groups, invites, months, categories, recurring, access }),
    log,
    withSessionCalls: () => withSessionCalls,
  };
}

describe('load', () => {
  it('グループと招待の一覧と、脱退の欄の添え書き用の固定費を、1回の withSession の中で読む', async () => {
    const { service, log, withSessionCalls } = setup();
    const data = await service.load('g1');
    assert.equal(data.group, group);
    assert.equal(data.invites, inviteList);
    assert.deepEqual(data.payerRecurring, { currentMonth: '2026-11', categories: categoryList, recurring: recurringList });
    assert.deepEqual(
      [...log].sort(),
      ['categories:S1:g1', 'group:S1:g1', 'list:S1:g1', 'months:S1:g1', 'recurring:S1:g1'],
    );
    assert.equal(withSessionCalls(), 1);
  });

  it('固定費が読めなくても、画面は失敗にしない（添え書きが出ないだけ。payerRecurring は null）', async () => {
    const { service } = setup({ failRecurringWith: new AuthError('network') });
    const data = await service.load('g1');
    assert.equal(data.group, group);
    assert.equal(data.invites, inviteList);
    assert.equal(data.payerRecurring, null);
  });

  it('固定費の読み込みが 401 のときは、握りつぶさずに投げる（セッション切れを伝える層へ届く）', async () => {
    const { service } = setup({ failRecurringWith: new AuthError('unauthorized') });
    await assert.rejects(service.load('g1'), (e) => e instanceof AuthError && e.code === 'unauthorized');
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
    const rest = {
      months: { list: async () => monthList } as unknown as MonthRepository,
      categories: { list: async () => categoryList } as unknown as CategoryRepository,
      recurring: { list: async () => recurringList } as unknown as RecurringRepository,
    };
    await assert.rejects(
      createInviteService({ groups, invites, ...rest, access }).load('g1'),
      (e) => e instanceof AuthError && e.code === 'network',
    );
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
