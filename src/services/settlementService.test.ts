// 月締め・精算のServiceのテスト。`npm test` で実行する。呼び出しが、必ず `withSession` を通すこと（セッション喪失の通知の
// 配線は、その包みだけが行う。CLAUDE.md）と、失敗がそのまま画面へ届くことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail } from '../domain/group.ts';
import type { MonthList, MonthView } from '../domain/month.ts';
import { AuthError } from '../repositories/authError.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { SettlementRepository } from '../repositories/settlementRepository.ts';
import type { SessionAccess } from './accountService.ts';
import { createSettlementService } from './settlementService.ts';

const group = { id: 'g1' } as GroupDetail;
const monthList: MonthList = { currentMonth: '2026-11', months: [{ month: '2026-11', status: 'open' }] };
const summary = { month: '2026-11' } as MonthView;

function setup(options: { session?: string; failWith?: Error; failRepository?: 'close' | 'summary' } = {}) {
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
  const settlements = {
    async close(session: string, groupId: string, month: string, acknowledgeDelete = false) {
      log.push(`close:${session}:${groupId}:${month}${acknowledgeDelete ? ':ack' : ''}`);
      if (options.failRepository === 'close') throw new AuthError('network');
      return { kind: 'closed' };
    },
    async settle(session: string, transferId: string) {
      log.push(`settle:${session}:${transferId}`);
      return { id: transferId };
    },
    async carry(session: string, transferId: string) {
      log.push(`carry:${session}:${transferId}`);
      return { id: transferId };
    },
  } as unknown as SettlementRepository;
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
    service: createSettlementService({ groups, months, settlements, access }),
    log,
    withSessionCalls: () => withSessionCalls,
  };
}

describe('settlementService', () => {
  it('loadClose は、1回の withSession の中で、グループ・月の一覧・その月の集計を読む', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.loadClose('g1', '2026-11'), { group, months: monthList, summary });
    assert.equal(withSessionCalls(), 1);
    assert.equal(log[0], 'withSession');
    assert.deepEqual(log.slice(1).sort(), ['group:SESSION:g1', 'months:SESSION:g1', 'summary:SESSION:g1:2026-11']);
  });

  it('close・settle・carry は、それぞれ1回の withSession を通して、Repository へ渡す', async () => {
    const { service, log, withSessionCalls } = setup({ session: 'SESSION' });
    assert.deepEqual(await service.close('g1', '2026-10'), { kind: 'closed' });
    assert.deepEqual(await service.settle('t1'), { id: 't1' });
    assert.deepEqual(await service.carry('t2'), { id: 't2' });
    assert.equal(withSessionCalls(), 3);
    assert.deepEqual(log, [
      'withSession',
      'close:SESSION:g1:2026-10',
      'withSession',
      'settle:SESSION:t1',
      'withSession',
      'carry:SESSION:t2',
    ]);
  });

  it('close の確認の申告（acknowledgeDelete）は、そのまま Repository へ渡す。既定は、申告なし', async () => {
    const { service, log } = setup({ session: 'SESSION' });
    await service.close('g1', '2026-10', true);
    await service.close('g1', '2026-10', false);
    assert.deepEqual(log.filter((entry) => entry.startsWith('close:')), ['close:SESSION:g1:2026-10:ack', 'close:SESSION:g1:2026-10']);
  });

  it('セッションの失敗は、Repository を呼ばず、そのまま画面へ届く', async () => {
    for (const code of ['not-signed-in', 'storage-failed', 'unauthorized'] as const) {
      const { service, log } = setup({ failWith: new AuthError(code) });
      const failsWith = (error: unknown) => error instanceof AuthError && error.code === code;
      await assert.rejects(service.loadClose('g1', '2026-11'), failsWith);
      await assert.rejects(service.close('g1', '2026-11'), failsWith);
      await assert.rejects(service.settle('t1'), failsWith);
      await assert.rejects(service.carry('t1'), failsWith);
      assert.ok(log.every((entry) => entry === 'withSession'), code);
    }
  });

  it('Repository の失敗は、そのまま画面へ届く（読み込みは、1つ失敗したら全体が失敗する）', async () => {
    const network = (error: unknown) => error instanceof AuthError && error.code === 'network';
    await assert.rejects(setup({ failRepository: 'summary' }).service.loadClose('g1', '2026-11'), network);
    await assert.rejects(setup({ failRepository: 'close' }).service.close('g1', '2026-11'), network);
  });
});
