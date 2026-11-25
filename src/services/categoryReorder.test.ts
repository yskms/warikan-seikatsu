// カテゴリの並べ替えの、並びの組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Category } from '../domain/month.ts';
import { applyReorder, buildReorderIds, isReordered, moveCategory } from './categoryReorder.ts';

const category = (id: string, archived = false, sortOrder = 0): Category => ({
  id,
  name: id,
  icon: 'cart',
  color: 'green',
  sortOrder,
  archived,
});

describe('moveCategory', () => {
  it('1つ上・1つ下へ動かす', () => {
    assert.deepEqual(moveCategory(['a', 'b', 'c'], 1, 'up'), ['b', 'a', 'c']);
    assert.deepEqual(moveCategory(['a', 'b', 'c'], 1, 'down'), ['a', 'c', 'b']);
  });

  it('端では動かさない（先頭の上・末尾の下）。同じ並びのコピーを返す', () => {
    const order = ['a', 'b', 'c'];
    for (const result of [moveCategory(order, 0, 'up'), moveCategory(order, 2, 'down')]) {
      assert.deepEqual(result, order);
      assert.notEqual(result, order);
    }
  });

  it('範囲外・小数の位置は、動かさない', () => {
    assert.deepEqual(moveCategory(['a', 'b'], -1, 'down'), ['a', 'b']);
    assert.deepEqual(moveCategory(['a', 'b'], 2, 'up'), ['a', 'b']);
    assert.deepEqual(moveCategory(['a', 'b', 'c'], 0.5, 'down'), ['a', 'b', 'c']);
    assert.deepEqual(moveCategory([], 0, 'down'), []);
  });

  it('元の配列は変えない', () => {
    const order = ['a', 'b', 'c'];
    moveCategory(order, 0, 'down');
    assert.deepEqual(order, ['a', 'b', 'c']);
  });
});

describe('isReordered', () => {
  it('並びが違えば true、同じなら false', () => {
    assert.equal(isReordered(['a', 'b', 'c'], ['a', 'b', 'c']), false);
    assert.equal(isReordered(['a', 'b', 'c'], ['b', 'a', 'c']), true);
  });

  it('動かして、元に戻したら false', () => {
    const base = ['a', 'b', 'c'];
    assert.equal(isReordered(base, moveCategory(moveCategory(base, 0, 'down'), 1, 'up')), false);
  });

  it('長さが違えば true', () => {
    assert.equal(isReordered(['a', 'b'], ['a']), true);
  });
});

describe('buildReorderIds', () => {
  it('使っている費目だけなら、並べ替えた順がそのまま送る並び', () => {
    const all = [category('a'), category('b'), category('c')];
    assert.deepEqual(buildReorderIds(all, ['c', 'a', 'b']), ['c', 'a', 'b']);
  });

  it('アーカイブした費目は、もとの位置（何番目か）のまま。使っている費目の枠だけを入れ替える', () => {
    const all = [category('a'), category('x', true), category('b'), category('y', true), category('c')];
    assert.deepEqual(buildReorderIds(all, ['c', 'b', 'a']), ['c', 'x', 'b', 'y', 'a']);
    // 並べ替えていなければ、いまの並びのまま
    assert.deepEqual(buildReorderIds(all, ['a', 'b', 'c']), ['a', 'x', 'b', 'y', 'c']);
  });

  it('全費目を、重複なく、1度ずつ含む', () => {
    const all = [category('x', true), category('a'), category('b'), category('y', true)];
    const ids = buildReorderIds(all, ['b', 'a'])!;
    assert.deepEqual([...ids].sort(), ['a', 'b', 'x', 'y']);
  });

  it('顔ぶれが違うとき（費目が増えた・アーカイブした・戻した・IDが違う・重複）は null', () => {
    const all = [category('a'), category('b'), category('x', true)];
    // 増えた（画面の並びが古い）
    assert.equal(buildReorderIds([...all, category('c')], ['b', 'a']), null);
    // 使っている費目を、他のメンバーがアーカイブした
    assert.equal(buildReorderIds([category('a'), category('b', true), category('x', true)], ['b', 'a']), null);
    // アーカイブした費目を、他のメンバーが戻した
    assert.equal(buildReorderIds([category('a'), category('b'), category('x')], ['b', 'a']), null);
    // 知らないID・重複
    assert.equal(buildReorderIds(all, ['a', 'z']), null);
    assert.equal(buildReorderIds(all, ['a', 'a']), null);
    assert.equal(buildReorderIds(all, ['a']), null);
  });

  it('使っている費目が無ければ、空の並びのとき、全費目をそのまま', () => {
    const all = [category('x', true), category('y', true)];
    assert.deepEqual(buildReorderIds(all, []), ['x', 'y']);
  });
});

describe('applyReorder', () => {
  it('送った並びのとおりに、費目を並び替え、並び順の値を振り直す。ほかの項目は変えない', () => {
    const all = [category('a', false, 5), category('x', true, 7), category('b', false, 9)];
    const ids = buildReorderIds(all, ['b', 'a'])!;
    assert.deepEqual(applyReorder(all, ids), [
      { ...category('b'), sortOrder: 0 },
      { ...category('x', true), sortOrder: 1 },
      { ...category('a'), sortOrder: 2 },
    ]);
  });

  it('全費目を1度ずつ含む並びでなければ、そのまま返す（足りない項目の費目を作らない）', () => {
    const all = [category('a', false, 5), category('b', false, 9)];
    assert.deepEqual(applyReorder(all, ['b', 'a', 'c']), all);
    assert.deepEqual(applyReorder(all, ['b', 'z']), all);
    assert.deepEqual(applyReorder(all, ['a', 'a']), all);
    assert.deepEqual(applyReorder(all, ['a']), all);
  });
});
