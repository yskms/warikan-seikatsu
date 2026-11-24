// 金額の表示のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CURRENCIES } from '../domain/group.ts';
import { currencySymbol, formatMoney, formatSignedMoney } from './money.ts';

describe('formatMoney', () => {
  it('小数のない通貨は、3桁区切り', () => {
    assert.equal(formatMoney(0, 'JPY', 0), '¥0');
    assert.equal(formatMoney(999, 'JPY', 0), '¥999');
    assert.equal(formatMoney(128450, 'JPY', 0), '¥128,450');
    assert.equal(formatMoney(1_000_000_000_000, 'JPY', 0), '¥1,000,000,000,000');
  });

  it('小数のある通貨は、最小単位から小数に直す（桁をそろえる）', () => {
    assert.equal(formatMoney(1234, 'USD', 2), '$12.34');
    assert.equal(formatMoney(5, 'USD', 2), '$0.05');
    assert.equal(formatMoney(100, 'EUR', 2), '€1.00');
    assert.equal(formatMoney(123456789, 'GBP', 2), '£1,234,567.89');
    assert.equal(formatMoney(12345, 'KWD', 3), 'KWD 12.345');
  });

  it('負の金額は、先頭に - を付ける', () => {
    assert.equal(formatMoney(-3000, 'JPY', 0), '-¥3,000');
    assert.equal(formatMoney(-5, 'USD', 2), '-$0.05');
  });

  it('選べる通貨は、すべて記号つきで出せる', () => {
    for (const currency of CURRENCIES) {
      assert.ok(!formatMoney(1000, currency.code, currency.minorUnit).startsWith(`${currency.code} `), currency.code);
    }
  });

  it('知らない通貨は、コードを前に付ける', () => {
    assert.equal(formatMoney(1000, 'XYZ', 0), 'XYZ 1,000');
  });

  it('通貨コードに継承されたプロパティ名が来ても、記号以外の値を出さない', () => {
    assert.equal(formatMoney(1000, 'toString', 0), 'toString 1,000');
    assert.equal(formatMoney(1000, 'constructor', 0), 'constructor 1,000');
  });

  it('壊れた値は、もっともらしい金額にしない', () => {
    assert.equal(formatMoney(Number.NaN, 'JPY', 0), '-');
    assert.equal(formatMoney(1.5, 'JPY', 0), '-');
    assert.equal(formatMoney(Number.MAX_SAFE_INTEGER + 2, 'JPY', 0), '-');
    assert.equal(formatMoney(100, 'JPY', -1), '-');
    assert.equal(formatMoney(100, 'JPY', 1.5), '-');
  });
});

describe('formatSignedMoney', () => {
  it('正は +、負は -、0は符号なし', () => {
    assert.equal(formatSignedMoney(3000, 'JPY', 0), '+¥3,000');
    assert.equal(formatSignedMoney(-3000, 'JPY', 0), '-¥3,000');
    assert.equal(formatSignedMoney(0, 'JPY', 0), '¥0');
  });
});

describe('currencySymbol', () => {
  it('選べる通貨は記号、知らない通貨はコード+空白、継承されたプロパティ名は記号にしない', () => {
    assert.equal(currencySymbol('JPY'), '¥');
    assert.equal(currencySymbol('USD'), '$');
    assert.equal(currencySymbol('XYZ'), 'XYZ ');
    assert.equal(currencySymbol('toString'), 'toString ');
  });
});
