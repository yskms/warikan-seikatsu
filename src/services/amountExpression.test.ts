// 金額の式（キーパッドの入力と評価）のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  amountState,
  evaluateExpression,
  expressionFromAmount,
  formatExpression,
  MAX_AMOUNT_MINOR,
  MAX_EXPRESSION_LENGTH,
  pressKey,
  type ExpressionKey,
} from './amountExpression.ts';

function type(keys: ExpressionKey[], minorUnit = 0, start = ''): string {
  return keys.reduce((expression, key) => pressKey(expression, key, minorUnit), start);
}

describe('pressKey', () => {
  it('数字を並べる。先頭の 0 は、次の数字で置き換える', () => {
    assert.equal(type(['1', '2', '0', '0']), '1200');
    assert.equal(type(['0', '5']), '5');
    assert.equal(type(['0', '0', '0']), '0');
    assert.equal(type(['5', '+', '0', '7']), '5+7');
  });

  it('00 は、0 を2回押したのと同じ（先頭の 0 は重ならない）', () => {
    assert.equal(type(['1', '00']), '100');
    assert.equal(type(['00']), '0');
    assert.equal(type(['1', '2', '00']), '1200');
    assert.equal(type(['1', '+', '00']), '1+0');
  });

  it('⌫ は、1文字消す。空なら空のまま', () => {
    assert.equal(type(['1', '2', 'back']), '1');
    assert.equal(type(['back']), '');
    assert.equal(type(['1', '+', 'back']), '1');
  });

  it('先頭には演算子を置けない。演算子の次の演算子は置き換える', () => {
    assert.equal(type(['+']), '');
    assert.equal(type(['-']), '');
    assert.equal(type(['1', '+', '-']), '1-');
    assert.equal(type(['1', '*', '/', '+']), '1+');
  });

  it('小数の無い通貨では `.` を受け付けない。小数のある通貨では、1つの数に1回だけ', () => {
    assert.equal(type(['1', '.', '5'], 0), '15');
    assert.equal(type(['1', '.', '5'], 2), '1.5');
    assert.equal(type(['1', '.', '5', '.', '2'], 2), '1.52');
    assert.equal(type(['.', '5'], 2), '0.5');
    assert.equal(type(['1', '+', '.', '5'], 2), '1+0.5');
    assert.equal(type(['1', '.', '+', '2'], 2), '1+2');
  });

  it('小数の桁数は、最小単位の桁数まで', () => {
    assert.equal(type(['1', '.', '2', '3', '4'], 2), '1.23');
    assert.equal(type(['1', '.', '0', '0', '0'], 2), '1.00');
    assert.equal(type(['1', '.', '00'], 2), '1.00');
    assert.equal(type(['1', '.', '00', '00'], 2), '1.00');
  });

  it('整数部は13桁まで。式の長さにも上限がある', () => {
    assert.equal(type(Array<ExpressionKey>(20).fill('9')), '9'.repeat(13));
    let expression = '';
    for (let i = 0; i < 100; i += 1) expression = pressKey(pressKey(expression, '1', 0), '+', 0);
    assert.ok(expression.length <= MAX_EXPRESSION_LENGTH);
  });
});

describe('evaluateExpression', () => {
  it('空・演算子だけの末尾は無いものとして扱う', () => {
    assert.deepEqual(evaluateExpression('', 0), { kind: 'empty' });
    assert.deepEqual(evaluateExpression('1200+', 0), { kind: 'value', minor: 1200, calculation: false });
    assert.deepEqual(evaluateExpression('12.', 2), { kind: 'value', minor: 1200, calculation: false });
    assert.deepEqual(evaluateExpression('0', 0), { kind: 'value', minor: 0, calculation: false });
  });

  it('足し算・引き算・掛け算・割り算（掛け算と割り算が先）', () => {
    assert.deepEqual(evaluateExpression('1200+800', 0), { kind: 'value', minor: 2000, calculation: true });
    assert.equal((evaluateExpression('1000-300', 0) as { minor: number }).minor, 700);
    assert.equal((evaluateExpression('2+3*4', 0) as { minor: number }).minor, 14);
    assert.equal((evaluateExpression('20-6/3', 0) as { minor: number }).minor, 18);
    assert.equal((evaluateExpression('100*3-50', 0) as { minor: number }).minor, 250);
    assert.equal((evaluateExpression('1000/4/5', 0) as { minor: number }).minor, 50);
  });

  it('途中で丸めない（1000÷3×3 は 1000）。最後に最小単位へ四捨五入する', () => {
    assert.equal((evaluateExpression('1000/3*3', 0) as { minor: number }).minor, 1000);
    assert.equal((evaluateExpression('1000/3', 0) as { minor: number }).minor, 333);
    assert.equal((evaluateExpression('2000/3', 0) as { minor: number }).minor, 667);
    // 0.5 は切り上げ
    assert.equal((evaluateExpression('5/2', 0) as { minor: number }).minor, 3);
    assert.equal((evaluateExpression('1/2', 0) as { minor: number }).minor, 1);
    assert.equal((evaluateExpression('1/4', 0) as { minor: number }).minor, 0);
  });

  it('小数のある通貨は、最小単位の整数にする', () => {
    assert.equal((evaluateExpression('12.5', 2) as { minor: number }).minor, 1250);
    assert.equal((evaluateExpression('12.34+0.66', 2) as { minor: number }).minor, 1300);
    assert.equal((evaluateExpression('10/3', 2) as { minor: number }).minor, 333);
    assert.equal((evaluateExpression('0.05', 2) as { minor: number }).minor, 5);
    assert.equal((evaluateExpression('1.005*1', 3) as { minor: number }).minor, 1005);
  });

  it('0で割る・桁あふれは invalid', () => {
    assert.deepEqual(evaluateExpression('5/0', 0), { kind: 'invalid' });
    assert.deepEqual(evaluateExpression('5/0.0', 1), { kind: 'invalid' });
    assert.deepEqual(evaluateExpression('1-1/0', 0), { kind: 'invalid' });
    assert.deepEqual(evaluateExpression(`${'9'.repeat(13)}*${'9'.repeat(13)}`, 0), { kind: 'invalid' });
  });

  it('引き算で0以下になっても、値は返す（保存できるかは、amountState）', () => {
    assert.equal((evaluateExpression('100-300', 0) as { minor: number }).minor, -200);
  });
});

describe('amountState', () => {
  it('保存できる金額か', () => {
    assert.deepEqual(amountState('', 0), { kind: 'empty' });
    assert.deepEqual(amountState('0', 0), { kind: 'not-positive', calculation: false });
    assert.deepEqual(amountState('100-300', 0), { kind: 'not-positive', calculation: true });
    assert.deepEqual(amountState('1/4', 0), { kind: 'not-positive', calculation: true });
    assert.deepEqual(amountState('1200+800', 0), { kind: 'ok', minor: 2000, calculation: true });
    assert.deepEqual(amountState('5/0', 0), { kind: 'invalid' });
  });

  it('上限は 10^12', () => {
    assert.equal(MAX_AMOUNT_MINOR, 1_000_000_000_000);
    assert.deepEqual(amountState('1000000000000', 0), { kind: 'ok', minor: 1_000_000_000_000, calculation: false });
    assert.deepEqual(amountState('1000000000001', 0), { kind: 'too-large', calculation: false });
    assert.deepEqual(amountState('999999999999+2', 0), { kind: 'too-large', calculation: true });
  });
});

describe('expressionFromAmount', () => {
  it('保存されている金額を、式なしで入れる', () => {
    assert.equal(expressionFromAmount(1200, 0), '1200');
    assert.equal(expressionFromAmount(1250, 2), '12.5');
    assert.equal(expressionFromAmount(1200, 2), '12');
    assert.equal(expressionFromAmount(5, 2), '0.05');
    assert.equal(expressionFromAmount(0, 0), '');
    assert.equal(expressionFromAmount(-1, 0), '');
  });

  it('入れ直した式は、同じ金額に評価される', () => {
    for (const [amount, unit] of [[1200, 0], [1250, 2], [5, 2], [123456789, 2], [1005, 3]] as const) {
      assert.equal((evaluateExpression(expressionFromAmount(amount, unit), unit) as { minor: number }).minor, amount);
    }
  });
});

describe('formatExpression', () => {
  it('整数部を3桁区切りにし、演算子を画面用の記号にする', () => {
    assert.equal(formatExpression('1200+800'), '1,200+800');
    assert.equal(formatExpression('1234567*2/3-1'), '1,234,567×2÷3−1');
    assert.equal(formatExpression('1234.5'), '1,234.5');
    assert.equal(formatExpression('12.'), '12.');
    assert.equal(formatExpression(''), '');
  });
});
