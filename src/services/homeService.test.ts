// ホームのServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通ること（セッション喪失の通知の
// 配線は、その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CategoryShares } from '../domain/categoryShare.ts';
import type { GroupDetail } from '../domain/group.ts';
import type { Category, ExpenseList, MonthList, MonthView } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import { AuthError } from '../repositories/authError.ts';
import type { CategoryRepository } from '../repositories/categoryRepository.ts';
import type { CategorySharesRepository } from '../repositories/categorySharesRepository.ts';
import type { ExpenseRepository } from '../repositories/expenseRepository.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { RecurringRepository } from '../repositories/recurringRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createHomeService } from './homeService.ts';

const group = { id: 'g1' } as GroupDetail;
const monthList: MonthList = { currentMonth: '2026-11', months: [{ month: '2026-11', status: 'open' }] };
const categoryList: Category[] = [{ id: 'c1', name: '食費', icon: 'cart', color: 'green', sortOrder: 1, archived: false }];
const recurringList = [{ id: 'r1' }] as RecurringExpense[];
const summary = { month: '2026-11' } as MonthView;
const expenseList: ExpenseList = { month: '2026-11', closed: false, expenses: [] };
const sharesList: CategoryShares = { month: '2026-11', closed: false, editable: true, memberIds: ['m1', 'm2'], categories: [] };

function setup(
  options: { session?: string; failWith?: Error; failRepository?: 'summary'; failRecurring?: Error; failShares?: Error } = {},
) {
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
    async summary(session: string, groupId: string, month: string) {
      log.push(`summary:${session}:${groupId}:${month}`);
      if (options.failRepository === 'summary') throw new AuthError('network');
      return summary;
    },
  } as unknown as MonthRepository;
  const expenses = {
    async list(session: string, groupId: string, month: string) {
      log.push(`expenses:${session}:${groupId}:${month}`);
      return expenseList;
    },
  } as unknown as ExpenseRepository;
  const categories = {
    async list(session: string, groupId: string) {
      log.push(`categories:${session}:${groupId}`);
      return categoryList;
    },
  } as unknown as CategoryRepository;
  const categoryShares = {
    async get(session: string, groupId: string, month: string) {
      log.push(`shares:${session}:${groupId}:${month}`);
      if (options.failShares) throw options.failShares;
      return sharesList;
    },
  } as unknown as CategorySharesRepository;
  const recurring = {
    async list(session: string, groupId: string) {
      log.push(`recurring:${session}:${groupId}`);
      if (options.failRecurring) throw options.failRecurring;
      return recurringList;
    },
  } as unknown as RecurringRepository;
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
    service: createHomeService({ groups, months, expenses, categories, categoryShares, recurring, access }),
    log,
    withSessionCalls: () => withSessionCalls,
  };
}

describe('homeService', () => {
  it('loadGroup は、1回の withSession の中で、グループ・月の一覧・費目・固定費を読む', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.loadGroup('g1'), {
      group,
      months: monthList,
      categories: categoryList,
      recurring: recurringList,
    });
    assert.equal(withSessionCalls(), 1);
    assert.equal(log[0], 'withSession');
    assert.deepEqual(log.slice(1).sort(), [
      'categories:SESSION:g1',
      'group:SESSION:g1',
      'months:SESSION:g1',
      'recurring:SESSION:g1',
    ]);
  });

  it('固定費だけが読めなくても、ホームは失敗にしない（お知らせが出ないだけ。recurring は null）', async () => {
    for (const code of ['network', 'unavailable', 'invalid-response'] as const) {
      const { service } = setup({ failRecurring: new AuthError(code) });
      assert.deepEqual(
        await service.loadGroup('g1'),
        { group, months: monthList, categories: categoryList, recurring: null },
        code,
      );
    }
  });

  it('固定費の読み込みが 401 のときは、握りつぶさずに投げる（セッション切れを伝える層へ届く）', async () => {
    const { service } = setup({ failRecurring: new AuthError('unauthorized') });
    await assert.rejects(service.loadGroup('g1'), (error) => error instanceof AuthError && error.code === 'unauthorized');
  });

  it('loadMonth は、1回の withSession の中で、月の集計・支出・費目の負担割合を、同じ月で読む', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.loadMonth('g1', '2026-11'), { summary, expenses: expenseList, shares: sharesList });
    assert.equal(withSessionCalls(), 1);
    assert.deepEqual(log.slice(1).sort(), [
      'expenses:SESSION:g1:2026-11',
      'shares:SESSION:g1:2026-11',
      'summary:SESSION:g1:2026-11',
    ]);
  });

  it('費目の負担割合だけが読めなくても、ホームは失敗にしない（内訳の割合が出ないだけ。shares は null）', async () => {
    // 参加前の月の403（`invalid-request` になる）、通信・5xx・応答の形の崩れ
    for (const code of ['invalid-request', 'network', 'unavailable', 'invalid-response'] as const) {
      const { service } = setup({ failShares: new AuthError(code) });
      assert.deepEqual(await service.loadMonth('g1', '2026-11'), { summary, expenses: expenseList, shares: null }, code);
    }
  });

  it('費目の負担割合の読み込みが 401 のときは、握りつぶさずに投げる（セッション切れを伝える層へ届く）', async () => {
    const { service } = setup({ failShares: new AuthError('unauthorized') });
    await assert.rejects(service.loadMonth('g1', '2026-11'), (error) => error instanceof AuthError && error.code === 'unauthorized');
  });

  it('セッションの失敗は、Repository を呼ばず、そのまま画面へ届く', async () => {
    for (const code of ['not-signed-in', 'storage-failed', 'unauthorized'] as const) {
      const { service, log } = setup({ failWith: new AuthError(code) });
      await assert.rejects(service.loadGroup('g1'), (error) => error instanceof AuthError && error.code === code);
      await assert.rejects(service.loadMonth('g1', '2026-11'), (error) => error instanceof AuthError && error.code === code);
      assert.ok(log.every((entry) => entry === 'withSession'), code);
    }
  });

  it('読み込みのどれかが失敗したら、全体が失敗する（一部だけの画面を出さない）', async () => {
    const { service } = setup({ failRepository: 'summary' });
    await assert.rejects(service.loadMonth('g1', '2026-11'), (error) => error instanceof AuthError && error.code === 'network');
  });
});
