// 固定費の登録の手順のテスト。`npm test` で実行する。`id` の使い回しと、結果が分からない失敗のあとの `PATCH`、登録が済んだあとの
// 失敗の扱いを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NewRecurringRequest, RecurringSaved, UpdateRecurringRequest } from '../domain/recurring.ts';
import { AuthError } from '../repositories/authError.ts';
import { RecurringRejectedError } from '../repositories/recurringRepository.ts';
import { createRecurringCreator, RecurringCreateFailure } from './recurringCreate.ts';

const body: NewRecurringRequest = {
  amountMinor: 80000,
  categoryId: 'c1',
  payerMemberId: 'm1',
  split: { method: 'category' },
  dayOfMonth: 25,
  startMonth: '2026-11',
  currencyCode: 'JPY',
};

type Step = 'ok' | 'network' | 'conflict' | 'rejected' | 'update-network';

function setup(script: Step[]) {
  const calls: string[] = [];
  const steps = [...script];
  let counter = 0;
  const creator = createRecurringCreator({
    async create(groupId, request) {
      calls.push(`create:${groupId}:${request.id}:${request.amountMinor}`);
      const step = steps.shift() ?? 'ok';
      if (step === 'network') throw new AuthError('network');
      if (step === 'conflict') throw new RecurringRejectedError(409, { reason: 'conflict' });
      if (step === 'rejected') throw new RecurringRejectedError(409, { reason: 'member_not_available', memberId: 'm2' });
      return { id: 'r1', thisMonthSkipped: false };
    },
    async update(recurringId, request: UpdateRecurringRequest): Promise<RecurringSaved> {
      calls.push(`update:${recurringId}:${JSON.stringify(request)}`);
      const step = steps.shift() ?? 'ok';
      if (step === 'update-network') throw new AuthError('network');
      return { id: recurringId, thisMonthSkipped: true };
    },
    newId: () => `id-${(counter += 1)}`,
  });
  return { creator, calls };
}

async function failure(promise: Promise<unknown>): Promise<RecurringCreateFailure> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof RecurringCreateFailure);
    return error;
  }
  assert.fail('失敗するはず');
}

describe('登録', () => {
  it('1回で済めば、登録だけを送る。結果をそのまま返す', async () => {
    const { creator, calls } = setup(['ok']);
    assert.deepEqual(await creator.submit('g1', body), { id: 'r1', thisMonthSkipped: false });
    assert.deepEqual(calls, ['create:g1:id-1:80000']);
    assert.equal(creator.created(), true);
  });

  it('結果が分からない失敗のあとは、同じ `id` で送り直す。入力を直していなくても、送り直したあとに `PATCH` する', async () => {
    const { creator, calls } = setup(['network', 'ok', 'ok']);
    const first = await failure(creator.submit('g1', body));
    assert.equal(first.step, 'create');
    assert.equal(creator.created(), false);
    const saved = await creator.submit('g1', { ...body, amountMinor: 85000 });
    // 直した金額が、`PATCH` で反映される。`PATCH` の結果（今月の分が作られないか）を返す
    assert.deepEqual(saved, { id: 'r1', thisMonthSkipped: true });
    assert.equal(calls[0], 'create:g1:id-1:80000');
    assert.equal(calls[1], 'create:g1:id-1:85000');
    assert.deepEqual(JSON.parse(calls[2].slice('update:r1:'.length)), {
      description: null,
      amountMinor: 85000,
      categoryId: 'c1',
      payerMemberId: 'm1',
      split: { method: 'category' },
      dayOfMonth: 25,
      startMonth: '2026-11',
      endMonth: null,
      currencyCode: 'JPY',
    });
  });

  it('`PATCH` の本文は、内容・終了する月があればそれを送る', async () => {
    const { creator, calls } = setup(['network', 'ok', 'ok']);
    await failure(creator.submit('g1', body));
    await creator.submit('g1', { ...body, description: '家賃', endMonth: '2027-10' });
    const patch = JSON.parse(calls[2].slice('update:r1:'.length));
    assert.equal(patch.description, '家賃');
    assert.equal(patch.endMonth, '2027-10');
  });

  it('サーバーが断った失敗（結果は分かっている）のあとは、`id` を使い回すが、成功しても `PATCH` しない', async () => {
    const { creator, calls } = setup(['rejected', 'ok']);
    const first = await failure(creator.submit('g1', body));
    assert.equal(first.step, 'create');
    await creator.submit('g1', body);
    assert.deepEqual(calls, ['create:g1:id-1:80000', 'create:g1:id-1:80000']);
  });

  it('結果が分からない失敗のあとに、サーバーが断った失敗が続いても、成功したら `PATCH` する（最初の送信が済んでいたかもしれない）', async () => {
    const { creator, calls } = setup(['network', 'rejected', 'ok', 'ok']);
    await failure(creator.submit('g1', body));
    await failure(creator.submit('g1', body));
    await creator.submit('g1', body);
    assert.equal(calls.length, 4);
    assert.ok(calls[3].startsWith('update:r1:'));
  });

  it('登録の409 `conflict`（他のグループが同じ `id` を使っている）は、登録されていない。新しい `id` にして、`PATCH` もしない', async () => {
    const { creator, calls } = setup(['network', 'conflict', 'ok']);
    await failure(creator.submit('g1', body));
    await failure(creator.submit('g1', body));
    await creator.submit('g1', body);
    assert.deepEqual(calls, ['create:g1:id-1:80000', 'create:g1:id-1:80000', 'create:g1:id-2:80000']);
  });

  it('登録が済んだあとの `PATCH` の失敗は、別の段階として返す。やり直しでは、登録を送らず、`PATCH` だけを送る（同じ固定費が2件にならない）', async () => {
    const { creator, calls } = setup(['network', 'ok', 'update-network', 'ok']);
    await failure(creator.submit('g1', body));
    const second = await failure(creator.submit('g1', { ...body, amountMinor: 90000 }));
    assert.equal(second.step, 'create-update');
    assert.ok(second.error instanceof AuthError);
    assert.equal(creator.created(), true);
    await creator.submit('g1', { ...body, amountMinor: 90000 });
    assert.deepEqual(
      calls.map((call) => call.split(':').slice(0, 2).join(':')),
      ['create:g1', 'create:g1', 'update:r1', 'update:r1'],
    );
  });
});
