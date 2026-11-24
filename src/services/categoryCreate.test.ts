// カテゴリの追加の手順のテスト。`npm test` で実行する。サーバーの代わりに、決めた順に成功・失敗を返す偽の呼び出しで、
// 「作成の `id` を使い回す」「結果が分からない失敗のあとの送り直しで、直した内容を `PATCH` で送る」「作成が済んだあとの失敗で、
// 作成をやり直さない（同じカテゴリを2つ作らない）」を確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { CategoryRejectedError } from '../repositories/categoryRepository.ts';
import { createCategoryAdder } from './categoryCreate.ts';

const rejected = (reason: string | null, status = 409) => new CategoryRejectedError(status, { reason });
const network = () => new AuthError('network');

/** 呼び出しごとに、決めた結果（`undefined` は成功）を順に返す偽。呼び出しの記録つき。 */
function setup(script: { create?: (Error | undefined)[]; update?: (Error | undefined)[] } = {}) {
  const createResults = [...(script.create ?? [])];
  const updateResults = [...(script.update ?? [])];
  const log: string[] = [];
  let ids = 0;
  const adder = createCategoryAdder({
    newId: () => `id${(ids += 1)}`,
    async createCategory(groupId, input) {
      log.push(`create:${groupId}:${input.id}:${input.name}`);
      const failure = createResults.shift();
      if (failure) throw failure;
      return { id: input.id };
    },
    async updateCategory(categoryId, input) {
      log.push(`update:${categoryId}:${input.name}`);
      const failure = updateResults.shift();
      if (failure) throw failure;
      return { id: categoryId };
    },
  });
  return { adder, log };
}

const body = (name: string) => ({ name, icon: 'cart', color: 'green' });

describe('createCategoryAdder', () => {
  it('作成が通れば、それだけ（PATCH は送らない）', async () => {
    const { adder, log } = setup();
    assert.deepEqual(await adder.submit('g1', body('美容')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:美容']);
  });

  it('サーバーが断った（作られていない）あとの送り直しは、同じ id で作成だけ。PATCH は送らない', async () => {
    const { adder, log } = setup({ create: [rejected('too_many_categories')] });
    const first = await adder.submit('g1', body('美容'));
    assert.equal(first.ok, false);
    assert.equal(first.ok === false && first.step, 'create');
    assert.deepEqual(await adder.submit('g1', body('美容2')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:美容', 'create:g1:id1:美容2']);
  });

  it('結果が分からない失敗（通信の失敗）のあとに、入力を直して送り直すと、同じ id で作成したあと、直した内容を PATCH で送る', async () => {
    const { adder, log } = setup({ create: [network()] });
    const first = await adder.submit('g1', body('美容'));
    assert.equal(first.ok === false && first.step, 'create');
    assert.deepEqual(await adder.submit('g1', body('美容院')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:美容', 'create:g1:id1:美容院', 'update:id1:美容院']);
  });

  it('応答が読めない失敗・混雑も、結果が分からないものとして、送り直しのあとに PATCH を送る', async () => {
    for (const code of ['invalid-response', 'unavailable'] as const) {
      const { adder, log } = setup({ create: [new AuthError(code)] });
      await adder.submit('g1', body('a'));
      await adder.submit('g1', body('b'));
      assert.deepEqual(log, ['create:g1:id1:a', 'create:g1:id1:b', 'update:id1:b'], code);
    }
  });

  it('指摘された流れ: 通信失敗 → 作成は成功したが PATCH が 409 → 次に押しても、作成はやり直さず、PATCH だけ（カテゴリは2つにならない）', async () => {
    const { adder, log } = setup({ create: [network()], update: [rejected('conflict')] });
    assert.equal((await adder.submit('g1', body('美容'))).ok, false);
    // 2回目: 作成は成功（保存済みが返る）。PATCH が 409 で断られる。作成の失敗ではなく、反映の失敗
    const second = await adder.submit('g1', body('美容院'));
    assert.equal(second.ok === false && second.step, 'create-update');
    assert.ok(second.ok === false && second.error instanceof CategoryRejectedError);
    // 3回目: 作成は送らない。いまの入力で PATCH だけ
    assert.deepEqual(await adder.submit('g1', body('美容院2')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:美容', 'create:g1:id1:美容院', 'update:id1:美容院', 'update:id1:美容院2']);
    // 作成は、同じ id で2回だけ（新しい id を作っていない）
    assert.equal(log.filter((entry) => entry.startsWith('create:')).length, 2);
    assert.ok(log.every((entry) => !entry.includes('id2')));
  });

  it('PATCH が、結果が分からない失敗（通信の失敗）でも、次は PATCH だけ', async () => {
    const { adder, log } = setup({ create: [network()], update: [network()] });
    await adder.submit('g1', body('a'));
    const second = await adder.submit('g1', body('b'));
    assert.equal(second.ok === false && second.step, 'create-update');
    assert.deepEqual(await adder.submit('g1', body('b')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:a', 'create:g1:id1:b', 'update:id1:b', 'update:id1:b']);
  });

  it('作成の呼び出しの 409 conflict は、作られていない。次は新しい id で、作成だけ（PATCH は送らない）', async () => {
    const { adder, log } = setup({ create: [rejected('conflict')] });
    const first = await adder.submit('g1', body('美容'));
    assert.equal(first.ok === false && first.step, 'create');
    assert.deepEqual(await adder.submit('g1', body('美容')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:美容', 'create:g1:id2:美容']);
  });

  it('結果が分からない失敗のあとに作成が 409 conflict になったら、作られていないので、新しい id で作成だけ（PATCH は送らない）', async () => {
    const { adder, log } = setup({ create: [network(), rejected('conflict')] });
    await adder.submit('g1', body('a'));
    await adder.submit('g1', body('b'));
    assert.deepEqual(await adder.submit('g1', body('c')), { ok: true });
    assert.deepEqual(log, ['create:g1:id1:a', 'create:g1:id1:b', 'create:g1:id2:c']);
  });

  it('作成が断られた失敗の種類は、そのまま返す（画面が文言を決める）', async () => {
    const error = rejected('too_many_categories');
    const { adder } = setup({ create: [error] });
    const result = await adder.submit('g1', body('x'));
    assert.ok(!result.ok);
    assert.equal(result.error, error);
  });
});
