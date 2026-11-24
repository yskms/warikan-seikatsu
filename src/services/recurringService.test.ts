// 固定費のServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通すこと（セッション喪失の通知の配線は、
// その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail } from '../domain/group.ts';
import type { Category, MonthList } from '../domain/month.ts';
import type { CreateRecurringRequest, RecurringExpense } from '../domain/recurring.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createRecurringService } from './recurringService.ts';

const group = { id: 'g1' } as GroupDetail;
const monthList: MonthList = { currentMonth: '2026-11', months: [{ month: '2026-11', status: 'open' }] };
const categoryList: Category[] = [{ id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false }];
const recurringList = [{ id: 'r1' }] as RecurringExpense[];

function setup(options: { session?: string; failWith?: Error } = {}) {
  const log: string[] = [];
  const groups = {
    async get(session: string, groupId: string) {
      log.push(`group:${session}:${groupId}`);
      return group;
    },
  } as unknown as GroupRepository;
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
      return recurringList;
    },
    async create(session: string, groupId: string, request: { id: string }) {
      log.push(`create:${session}:${groupId}:${request.id}`);
      return { id: request.id, thisMonthSkipped: true };
    },
    async update(session: string, recurringId: string, request: unknown) {
      log.push(`update:${session}:${recurringId}:${JSON.stringify(request)}`);
      return { id: recurringId, thisMonthSkipped: false };
    },
    async remove(session: string, recurringId: string) {
      log.push(`remove:${session}:${recurringId}`);
    },
  } as unknown as RecurringRepository;
  let withSessionCalls = 0;
  const access: SessionAccess = {
    async withSession<T>(operation: (session: string) => Promise<T>): Promise<T> {
      withSessionCalls += 1;
      if (options.failWith) throw options.failWith;
      return operation(options.session ?? 'S');
    },
  };
  const service = createRecurringService({ groups, months, categories, recurring, access });
  return { service, log, withSessionCalls: () => withSessionCalls };
}

const request: CreateRecurringRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  amountMinor: 80000,
  categoryId: 'c1',
  payerMemberId: 'm1',
  split: { method: 'category' },
  dayOfMonth: 25,
  startMonth: '2026-11',
  currencyCode: 'JPY',
};

describe('load', () => {
  it('グループ・月・カテゴリ・固定費を、1回の `withSession` で読む', async () => {
    const { service, log, withSessionCalls } = setup();
    const data = await service.load('g1');
    assert.deepEqual(data, { group, months: monthList, categories: categoryList, recurring: recurringList });
    assert.deepEqual([...log].sort(), ['categories:S:g1', 'group:S:g1', 'months:S:g1', 'recurring:S:g1']);
    assert.equal(withSessionCalls(), 1);
  });

  it('失敗は、そのまま画面へ届く', async () => {
    const { service } = setup({ failWith: new AuthError('network') });
    await assert.rejects(service.load('g1'), (error) => error instanceof AuthError && error.code === 'network');
  });
});

describe('書き込み', () => {
  it('登録・変更・止める・削除は、`withSession` を通して、セッションを渡す', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.create('g1', request), { id: request.id, thisMonthSkipped: true });
    assert.deepEqual(await service.update('r1', { paused: true }), { id: 'r1', thisMonthSkipped: false });
    await service.remove('r1');
    assert.deepEqual(log, [`create:SESSION:g1:${request.id}`, 'update:SESSION:r1:{"paused":true}', 'remove:SESSION:r1']);
    assert.equal(withSessionCalls(), 3);
  });

  it('セッションが無いときの失敗は、そのまま届き、書き込みは行われない', async () => {
    const { service, log } = setup({ failWith: new AuthError('not-signed-in') });
    await assert.rejects(service.create('g1', request), (error) => error instanceof AuthError && error.code === 'not-signed-in');
    await assert.rejects(service.update('r1', { paused: true }), (error) => error instanceof AuthError);
    await assert.rejects(service.remove('r1'), (error) => error instanceof AuthError);
    assert.deepEqual(log, []);
  });
});
