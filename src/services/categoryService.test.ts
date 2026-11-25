// カテゴリと負担割合のServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通すこと（セッション喪失の
// 通知の配線は、その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くこと、出す月の選び方を確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CategoryShares } from '../domain/categoryShare.ts';
import type { GroupDetail } from '../domain/group.ts';
import type { Category, MonthList } from '../domain/month.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { CategorySharesRepository } from '../repositories/categorySharesRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createCategoryService } from './categoryService.ts';

const group = { id: 'g1' } as GroupDetail;
const categoryList: Category[] = [{ id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false }];
const defaultMonths: MonthList = {
  currentMonth: '2026-11',
  months: [
    { month: '2026-10', status: 'settled' },
    { month: '2026-11', status: 'open' },
    { month: '2026-12', status: 'open' },
  ],
};
const sharesOf = (month: string): CategoryShares => ({ month, closed: false, editable: true, memberIds: [], categories: [] });

function setup(options: { session?: string; failWith?: Error; months?: MonthList; failRepository?: 'shares' | 'put' } = {}) {
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
      return options.months ?? defaultMonths;
    },
  } as unknown as MonthRepository;
  const categories = {
    async list(session: string, groupId: string) {
      log.push(`categories:${session}:${groupId}`);
      return categoryList;
    },
    async create(session: string, groupId: string, input: { id: string }) {
      log.push(`create:${session}:${groupId}:${input.id}`);
      return { id: input.id };
    },
    async update(session: string, categoryId: string, input: { archived?: boolean }) {
      log.push(`update:${session}:${categoryId}:${JSON.stringify(input)}`);
      return { id: categoryId };
    },
    async reorder(session: string, groupId: string, ids: string[]) {
      log.push(`reorder:${session}:${groupId}:${ids.join(',')}`);
    },
  } as unknown as CategoryRepository;
  const shares = {
    async get(session: string, groupId: string, month: string) {
      log.push(`shares:${session}:${groupId}:${month}`);
      if (options.failRepository === 'shares') throw new AuthError('network');
      return sharesOf(month);
    },
    async put(session: string, groupId: string, month: string, categoryId: string) {
      log.push(`put:${session}:${groupId}:${month}:${categoryId}`);
      if (options.failRepository === 'put') throw new AuthError('network');
      return { overriddenMonths: ['2027-01'] };
    },
    async acknowledgeReset(session: string, groupId: string, month: string, through: number) {
      log.push(`acknowledge:${session}:${groupId}:${month}:${through}`);
      if (options.failRepository === 'put') throw new AuthError('network');
    },
  } as unknown as CategorySharesRepository;
  let withSessionCalls = 0;
  const access: SessionAccess = {
    async withSession(task) {
      withSessionCalls += 1;
      log.push('withSession');
      if (options.failWith) throw options.failWith;
      return task(options.session ?? 'S');
    },
  };
  return {
    service: createCategoryService({ groups, months, categories, shares, access }),
    log,
    withSessionCalls: () => withSessionCalls,
  };
}

describe('categoryService.load', () => {
  it('1回の withSession の中で、グループ・月の一覧・費目を読み、出す月の割合を読む', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    const data = await service.load('g1', '2026-12');
    assert.deepEqual(data, { group, months: defaultMonths, categories: categoryList, month: '2026-12', shares: sharesOf('2026-12') });
    assert.equal(withSessionCalls(), 1);
    assert.equal(log[0], 'withSession');
    // 割合は、出す月が決まってから（月の一覧を読んだあと）読む
    assert.equal(log.at(-1), 'shares:SESSION:g1:2026-12');
    assert.deepEqual(log.slice(1, -1).sort(), ['categories:SESSION:g1', 'group:SESSION:g1', 'months:SESSION:g1']);
  });

  it('選びたい月が無ければ今月。選べる月が無ければ、割合は読まない（month・shares は null）', async () => {
    assert.equal((await setup().service.load('g1', null)).month, '2026-11');
    const closedAll: MonthList = { currentMonth: '2026-11', months: [{ month: '2026-11', status: 'settled' }] };
    const { service, log } = setup({ months: closedAll });
    const data = await service.load('g1', null);
    assert.equal(data.month, null);
    assert.equal(data.shares, null);
    assert.ok(!log.some((entry) => entry.startsWith('shares:')));
  });
});

describe('categoryService の書き込み', () => {
  it('loadShares・saveShare・createCategory・updateCategory・reorderCategories は、それぞれ1回の withSession を通す', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.loadShares('g1', '2026-12'), sharesOf('2026-12'));
    assert.deepEqual(
      await service.saveShare('g1', '2026-11', 'c1', { shares: [], cap: null, currencyCode: null }),
      { overriddenMonths: ['2027-01'] },
    );
    assert.deepEqual(await service.createCategory('g1', { id: 'u1', name: 'x', icon: 'cart', color: 'green' }), { id: 'u1' });
    assert.deepEqual(await service.updateCategory('c1', { archived: true }), { id: 'c1' });
    await service.reorderCategories('g1', ['c2', 'c1']);
    assert.equal(withSessionCalls(), 5);
    assert.deepEqual(log, [
      'withSession',
      'shares:SESSION:g1:2026-12',
      'withSession',
      'put:SESSION:g1:2026-11:c1',
      'withSession',
      'create:SESSION:g1:u1',
      'withSession',
      'update:SESSION:c1:{"archived":true}',
      'withSession',
      'reorder:SESSION:g1:c2,c1',
    ]);
  });

  it('acknowledgeSharesReset は、1回の withSession を通して、見直しの確認を送る。失敗はそのまま画面へ届く', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    await service.acknowledgeSharesReset('g1', '2026-11', 1_795_057_200_000);
    assert.equal(withSessionCalls(), 1);
    assert.deepEqual(log, ['withSession', 'acknowledge:SESSION:g1:2026-11:1795057200000']);
    await assert.rejects(
      setup({ failRepository: 'put' }).service.acknowledgeSharesReset('g1', '2026-11', 1),
      (error) => error instanceof AuthError && error.code === 'network',
    );
    const failing = setup({ failWith: new AuthError('unauthorized') });
    await assert.rejects(failing.service.acknowledgeSharesReset('g1', '2026-11', 1), (error) => error instanceof AuthError && error.code === 'unauthorized');
    assert.deepEqual(failing.log, ['withSession']);
  });

  it('セッションの失敗は、Repository を呼ばず、そのまま画面へ届く', async () => {
    for (const code of ['not-signed-in', 'storage-failed', 'unauthorized'] as const) {
      const { service, log } = setup({ failWith: new AuthError(code) });
      const failsWith = (error: unknown) => error instanceof AuthError && error.code === code;
      await assert.rejects(service.load('g1', null), failsWith);
      await assert.rejects(service.loadShares('g1', '2026-11'), failsWith);
      await assert.rejects(service.saveShare('g1', '2026-11', 'c1', { shares: [], cap: null, currencyCode: null }), failsWith);
      await assert.rejects(service.createCategory('g1', { id: 'u1', name: 'x', icon: 'cart', color: 'green' }), failsWith);
      await assert.rejects(service.updateCategory('c1', { name: 'y' }), failsWith);
      await assert.rejects(service.reorderCategories('g1', ['c1']), failsWith);
      assert.ok(log.every((entry) => entry === 'withSession'), code);
    }
  });

  it('Repository の失敗は、そのまま画面へ届く（読み込みは、割合の失敗でも全体が失敗する）', async () => {
    const network = (error: unknown) => error instanceof AuthError && error.code === 'network';
    await assert.rejects(setup({ failRepository: 'shares' }).service.load('g1', null), network);
    await assert.rejects(setup({ failRepository: 'shares' }).service.loadShares('g1', '2026-11'), network);
    await assert.rejects(
      setup({ failRepository: 'put' }).service.saveShare('g1', '2026-11', 'c1', { shares: [], cap: null, currencyCode: null }),
      network,
    );
  });
});
