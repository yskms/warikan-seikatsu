// 負担割合の表示のテスト。`npm test` で実行する。計算は確かめない（Workerだけが持つ）。割合を文字にすることだけを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatPercent, formatShareRatio } from './shareFormat.ts';

describe('formatPercent', () => {
  it('整数の%はそのまま、端数は小数第2位まで（末尾の0は落とす）', () => {
    assert.equal(formatPercent(6500), '65%');
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(10000), '100%');
    assert.equal(formatPercent(3334), '33.34%');
    assert.equal(formatPercent(3333), '33.33%');
    assert.equal(formatPercent(3330), '33.3%');
    assert.equal(formatPercent(1), '0.01%');
  });
});

describe('formatShareRatio', () => {
  it('2人で、どちらも10%単位なら「7:3」', () => {
    assert.equal(formatShareRatio([7000, 3000]), '7:3');
    assert.equal(formatShareRatio([3000, 7000]), '3:7');
    assert.equal(formatShareRatio([10000, 0]), '10:0');
    assert.equal(formatShareRatio([0, 10000]), '0:10');
  });

  it('2人の5:5は、均等ではなく「5:5」', () => {
    assert.equal(formatShareRatio([5000, 5000]), '5:5');
  });

  it('2人で、10%単位でなければ「65% : 35%」', () => {
    assert.equal(formatShareRatio([6500, 3500]), '65% : 35%');
    assert.equal(formatShareRatio([3334, 6666]), '33.34% : 66.66%');
  });

  it('3人以上は、%を並べる', () => {
    assert.equal(formatShareRatio([4000, 3000, 3000]), '40% / 30% / 30%');
    assert.equal(formatShareRatio([5000, 2500, 1250, 1250]), '50% / 25% / 12.5% / 12.5%');
  });

  it('3人以上で、均等にリセットした割合は「均等」（端数の0.01%の差を含む）', () => {
    assert.equal(formatShareRatio([3334, 3333, 3333]), '均等');
    assert.equal(formatShareRatio([3333, 3334, 3333]), '均等');
    assert.equal(formatShareRatio([2500, 2500, 2500, 2500]), '均等');
    assert.equal(formatShareRatio([2000, 2000, 2000, 2000, 2000]), '均等');
  });

  it('3人以上で、差が0.01%を超えるものは均等にしない', () => {
    assert.equal(formatShareRatio([3400, 3300, 3300]), '34% / 33% / 33%');
  });

  it('合計が10000でない壊れた値は、均等にしない（もっともらしく見せない）', () => {
    assert.equal(formatShareRatio([3333, 3333, 3333]), '33.33% / 33.33% / 33.33%');
  });

  it('1人は100%、0人は空', () => {
    assert.equal(formatShareRatio([10000]), '100%');
    assert.equal(formatShareRatio([]), '');
  });
});
