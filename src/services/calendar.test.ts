// 日付・月の計算のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dateOf, daysInMonth, isRealDate, monthGrid, monthIndex, monthOfDate, shiftMonth, todayIn } from './calendar.ts';

describe('日付と月', () => {
  it('isRealDate', () => {
    assert.equal(isRealDate('2026-11-19'), true);
    assert.equal(isRealDate('2024-02-29'), true);
    assert.equal(isRealDate('2026-02-29'), false);
    assert.equal(isRealDate('2026-02-30'), false);
    assert.equal(isRealDate('2026-13-01'), false);
    assert.equal(isRealDate('2026-1-1'), false);
    assert.equal(isRealDate(''), false);
  });

  it('monthOfDate / monthIndex / shiftMonth', () => {
    assert.equal(monthOfDate('2026-11-19'), '2026-11');
    assert.equal(monthOfDate('2026-11'), null);
    assert.equal(monthIndex('2026-11'), 2026 * 12 + 10);
    assert.equal(monthIndex('x'), null);
    assert.equal(shiftMonth('2026-11', 1), '2026-12');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-11', -23), '2024-12');
    assert.equal(shiftMonth('0000-01', -1), null);
    assert.equal(shiftMonth('x', 1), null);
  });

  it('daysInMonth / dateOf', () => {
    assert.equal(daysInMonth('2026-11'), 30);
    assert.equal(daysInMonth('2026-02'), 28);
    assert.equal(daysInMonth('2024-02'), 29);
    assert.equal(daysInMonth('2026-12'), 31);
    assert.equal(daysInMonth('x'), null);
    assert.equal(dateOf('2026-11', 5), '2026-11-05');
    assert.equal(dateOf('2026-11', 30), '2026-11-30');
    assert.equal(dateOf('2026-11', 31), null);
    assert.equal(dateOf('2026-11', 0), null);
    assert.equal(dateOf('2026-11', 1.5), null);
  });
});

describe('monthGrid', () => {
  it('日曜始まりの週に並べる（月の外は null）', () => {
    // 2026-11-01 は日曜
    const grid = monthGrid('2026-11');
    assert.deepEqual(grid[0], [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(grid[grid.length - 1], [29, 30, null, null, null, null, null]);
    assert.equal(grid.length, 5);
  });

  it('月初が日曜でない月は、前を null で埋める。どの週も7つ', () => {
    // 2026-10-01 は木曜
    const grid = monthGrid('2026-10');
    assert.deepEqual(grid[0], [null, null, null, null, 1, 2, 3]);
    for (const week of monthGrid('2026-02')) assert.equal(week.length, 7);
    assert.equal(monthGrid('2026-10').flat().filter((day) => day !== null).length, 31);
  });

  it('形が違う月は空', () => {
    assert.deepEqual(monthGrid('x'), []);
  });
});

describe('todayIn', () => {
  it('指定のタイムゾーンでの日付にする（日付が変わる境目）', () => {
    // UTCの 2026-11-19 20:00 は、東京では 11-20 05:00、ニューヨークでは 11-19 15:00
    const now = new Date(Date.UTC(2026, 10, 19, 20, 0, 0));
    assert.equal(todayIn(now, 'Asia/Tokyo'), '2026-11-20');
    assert.equal(todayIn(now, 'America/New_York'), '2026-11-19');
    assert.equal(todayIn(now, 'UTC'), '2026-11-19');
  });

  it('知らないタイムゾーン名は、端末の日付にする（例外にしない）', () => {
    const now = new Date(2026, 10, 19, 12, 0, 0);
    assert.equal(todayIn(now, 'Not/AZone'), '2026-11-19');
    assert.equal(todayIn(now, ''), '2026-11-19');
  });
});
