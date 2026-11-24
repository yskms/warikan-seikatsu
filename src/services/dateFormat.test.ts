// 月・日付の表示のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatExpenseDate, formatMonth, formatMonthShort, nextMonth, previousMonth } from './dateFormat.ts';

describe('月の表示', () => {
  it('formatMonth / formatMonthShort', () => {
    assert.equal(formatMonth('2026-11'), '2026年11月');
    assert.equal(formatMonth('2026-01'), '2026年1月');
    assert.equal(formatMonthShort('2026-11'), '11月');
    assert.equal(formatMonthShort('2026-01'), '1月');
  });

  it('形が違う値は、そのまま返す', () => {
    for (const value of ['', '2026-13', '2026-00', '2026-1', 'abc', '2026-11-01']) {
      assert.equal(formatMonth(value), value);
      assert.equal(formatMonthShort(value), value);
    }
  });
});

describe('previousMonth', () => {
  it('1つ前の月（年をまたぐ）', () => {
    assert.equal(previousMonth('2026-11'), '2026-10');
    assert.equal(previousMonth('2026-02'), '2026-01');
    assert.equal(previousMonth('2026-01'), '2025-12');
    assert.equal(previousMonth('0001-01'), '0000-12');
  });

  it('形が違う値は null', () => {
    assert.equal(previousMonth('2026-13'), null);
    assert.equal(previousMonth('x'), null);
  });
});

describe('nextMonth', () => {
  it('1つ後の月（年をまたぐ）', () => {
    assert.equal(nextMonth('2026-11'), '2026-12');
    assert.equal(nextMonth('2026-01'), '2026-02');
    assert.equal(nextMonth('2026-12'), '2027-01');
  });

  it('形が違う値は null', () => {
    assert.equal(nextMonth('2026-13'), null);
    assert.equal(nextMonth('x'), null);
  });
});

describe('formatExpenseDate', () => {
  it('月/日(曜日)', () => {
    assert.equal(formatExpenseDate('2026-11-19'), '11/19(木)');
    assert.equal(formatExpenseDate('2026-11-01'), '11/1(日)');
    assert.equal(formatExpenseDate('2024-02-29'), '2/29(木)');
  });

  it('実在しない日付は、曜日を付けない', () => {
    assert.equal(formatExpenseDate('2026-02-30'), '2/30');
    assert.equal(formatExpenseDate('2025-02-29'), '2/29');
  });

  it('形が違う値は、そのまま返す', () => {
    assert.equal(formatExpenseDate('2026-11'), '2026-11');
    assert.equal(formatExpenseDate(''), '');
  });
});
