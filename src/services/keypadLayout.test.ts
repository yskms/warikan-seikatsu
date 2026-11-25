// キーパッドの並びのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_KEYPAD_LAYOUT, KEYPAD_LAYOUTS, keypadRows, parseKeypadLayout, type KeySpec } from './keypadLayout.ts';

function keys(rows: KeySpec[][]): string[][] {
  return rows.map((row) => row.map((spec) => spec.key));
}

describe('keypadRows', () => {
  it('スマホは 1 2 3 が上', () => {
    assert.deepEqual(keys(keypadRows('phone', 0)), [
      ['1', '2', '3', '/'],
      ['4', '5', '6', '*'],
      ['7', '8', '9', '-'],
      ['0', '00', 'back', '+'],
    ]);
  });

  it('電卓は 7 8 9 が上', () => {
    assert.deepEqual(keys(keypadRows('calculator', 0)), [
      ['7', '8', '9', '/'],
      ['4', '5', '6', '*'],
      ['1', '2', '3', '-'],
      ['0', '00', 'back', '+'],
    ]);
  });

  it('演算子・0・00・⌫の位置は、どちらの並びでも同じ', () => {
    const phone = keypadRows('phone', 0);
    const calculator = keypadRows('calculator', 0);
    for (const row of [0, 1, 2]) assert.equal(phone[row]![3]!.key, calculator[row]![3]!.key);
    assert.deepEqual(keys([phone[3]!]), keys([calculator[3]!]));
  });

  it('小数のある通貨では、00 の代わりに . が出る（どちらの並びでも、同じ位置）', () => {
    for (const layout of KEYPAD_LAYOUTS) {
      const last = keypadRows(layout, 2)[3]!;
      assert.deepEqual(
        last.map((spec) => spec.key),
        ['0', '.', 'back', '+'],
      );
    }
  });

  it('数字は1〜9が1回ずつ出る（どちらの並びでも、欠けも重なりもない）', () => {
    for (const layout of KEYPAD_LAYOUTS) {
      const digits = keypadRows(layout, 0)
        .slice(0, 3)
        .flatMap((row) => row.slice(0, 3).map((spec) => spec.key))
        .sort();
      assert.deepEqual(digits, ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    }
  });

  it('演算子のキーだけ operator が付く', () => {
    const flat = keypadRows('phone', 0).flat();
    assert.deepEqual(
      flat.filter((spec) => spec.operator).map((spec) => spec.key),
      ['/', '*', '-', '+'],
    );
  });
});

describe('parseKeypadLayout', () => {
  it('知っている値を読む（前後の空白・改行は無視）', () => {
    assert.equal(parseKeypadLayout('phone'), 'phone');
    assert.equal(parseKeypadLayout('calculator\n'), 'calculator');
    assert.equal(parseKeypadLayout('  phone '), 'phone');
  });

  it('空・知らない値は null（将来、別の値が書かれても、初期値に戻るだけ）', () => {
    assert.equal(parseKeypadLayout(''), null);
    assert.equal(parseKeypadLayout('Phone'), null);
    assert.equal(parseKeypadLayout('numpad'), null);
  });

  it('初期値は、選べる並びの先頭（スマホ）', () => {
    assert.equal(DEFAULT_KEYPAD_LAYOUT, 'phone');
    assert.equal(KEYPAD_LAYOUTS[0], DEFAULT_KEYPAD_LAYOUT);
  });
});
