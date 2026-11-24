// 固定費の一覧に出す内容の組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { Category } from '../domain/month.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import {
  buildRecurringSections,
  CATEGORY_ARCHIVED_TEXT,
  dayNote,
  dayText,
  describeSplit,
  pausedReasonText,
  statusOf,
} from './recurringView.ts';
import type { RecurringData } from './recurringService.ts';

function member(id: string, displayName: string): GroupMember {
  return {
    id,
    displayName,
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-01',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
    isMe: id === 'm1',
  };
}

const categories: Category[] = [
  { id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false },
  { id: 'c2', name: '食費', icon: 'cart', color: 'green', sortOrder: 2, archived: true },
];

function item(extra: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'r1',
    description: '家賃',
    amountMinor: 80000,
    categoryId: 'c1',
    categoryArchived: false,
    payerMemberId: 'm1',
    split: { method: 'category' },
    dayOfMonth: 25,
    startMonth: '2026-11',
    endMonth: null,
    pausedAt: null,
    pausedReason: null,
    ...extra,
  };
}

function data(recurring: RecurringExpense[]): RecurringData {
  const group = {
    id: 'g1',
    currencyCode: 'JPY',
    currencyMinorUnit: 0,
    members: [member('m1', 'あなた'), member('m2', '彼女')],
  } as unknown as GroupDetail;
  return { group, months: { currentMonth: '2026-11', months: [] }, categories, recurring };
}

describe('文言', () => {
  it('毎月の日。29〜31日には、その日が無い月の添え書き', () => {
    assert.equal(dayText(25), '毎月25日');
    assert.equal(dayNote(28), null);
    assert.equal(dayNote(29), 'その日がない月は、月末日に登録します。');
    assert.equal(dayNote(31), 'その日がない月は、月末日に登録します。');
  });

  it('止めた理由。止まっていなければ `null`、知らない理由は「止まっています」', () => {
    assert.equal(pausedReasonText({ pausedAt: null, pausedReason: null }), null);
    assert.equal(pausedReasonText({ pausedAt: 1, pausedReason: 'manual' }), '止めています');
    assert.equal(pausedReasonText({ pausedAt: 1, pausedReason: 'payer_left' }), '支払う人が脱退しました。支払う人を選び直してください');
    assert.equal(pausedReasonText({ pausedAt: 1, pausedReason: 'member_changed' }), 'メンバーが変わったため、負担の見直しが必要です');
    assert.equal(pausedReasonText({ pausedAt: 1, pausedReason: 'unknown' }), '止まっています');
    assert.equal(pausedReasonText({ pausedAt: 1, pausedReason: null }), '止まっています');
  });
});

describe('statusOf', () => {
  it('終了する月が今月より前なら終了（止まっていても）。今月までは、終了ではない', () => {
    assert.equal(statusOf(item({ endMonth: '2026-10' }), '2026-11'), 'ended');
    assert.equal(statusOf(item({ endMonth: '2026-10', pausedAt: 1 }), '2026-11'), 'ended');
    assert.equal(statusOf(item({ endMonth: '2026-11' }), '2026-11'), 'active');
    assert.equal(statusOf(item({ pausedAt: 1 }), '2026-11'), 'paused');
    assert.equal(statusOf(item(), '2026-11'), 'active');
  });
});

describe('buildRecurringSections', () => {
  it('止まっている・登録している・終了したに分ける（それぞれ、サーバーの順）', () => {
    const sections = buildRecurringSections(
      data([
        item({ id: 'a', description: 'A' }),
        item({ id: 'b', description: 'B', pausedAt: 1, pausedReason: 'manual' }),
        item({ id: 'c', description: 'C', endMonth: '2026-09' }),
        item({ id: 'd', description: 'D' }),
        item({ id: 'e', description: 'E', pausedAt: 1, pausedReason: 'member_changed' }),
      ]),
    );
    assert.deepEqual(sections.paused.map((row) => row.id), ['b', 'e']);
    assert.deepEqual(sections.active.map((row) => row.id), ['a', 'd']);
    assert.deepEqual(sections.ended.map((row) => row.id), ['c']);
  });

  it('1行に、内容・金額・毎月の日・支払う人・カテゴリを出す', () => {
    const [row] = buildRecurringSections(data([item({ payerMemberId: 'm2' })])).active;
    assert.equal(row.title, '家賃');
    assert.equal(row.amountText, '¥80,000');
    assert.equal(row.detailText, '毎月25日・支払う人 彼女・家賃');
    assert.equal(row.categoryIcon, 'home');
    assert.equal(row.categoryColor, 'blue');
    assert.equal(row.statusText, null);
    assert.equal(row.attention, false);
    assert.equal(row.customSplit, false);
    assert.equal(row.label, '家賃、¥80,000、毎月25日・支払う人 彼女・家賃');
  });

  it('内容が無ければ、カテゴリの名前を題にする', () => {
    const [row] = buildRecurringSections(data([item({ description: null, categoryId: 'c2', categoryArchived: true })])).active;
    assert.equal(row.title, '食費');
  });

  it('止まっている固定費は、理由を添えて、注意として出す', () => {
    const [row] = buildRecurringSections(data([item({ pausedAt: 1, pausedReason: 'payer_left' })])).paused;
    assert.equal(row.statusText, '支払う人が脱退しました。支払う人を選び直してください');
    assert.equal(row.attention, true);
    assert.match(row.label, /支払う人が脱退しました/);
  });

  it('カテゴリを使わない設定にしている固定費は、止めずに「自動登録されていません」と出す', () => {
    const sections = buildRecurringSections(data([item({ categoryId: 'c2', categoryArchived: true })]));
    assert.equal(sections.paused.length, 0);
    const [row] = sections.active;
    assert.equal(row.statusText, CATEGORY_ARCHIVED_TEXT);
    assert.equal(row.attention, true);
  });

  it('終了した固定費は、終了した月を添える。止めた理由・自動登録されていない案内は、出さない', () => {
    const [row] = buildRecurringSections(
      data([item({ endMonth: '2026-09', pausedAt: 1, pausedReason: 'payer_left', categoryId: 'c2', categoryArchived: true })]),
    ).ended;
    assert.equal(row.statusText, '2026年9月で終了しました');
    assert.equal(row.attention, false);
  });

  it('負担を変えている固定費・負担の方法を読めない固定費には、印を付ける', () => {
    const rows = buildRecurringSections(
      data([
        item({ id: 'a', split: { method: 'equal', memberIds: ['m1', 'm2'] } }),
        item({ id: 'b', split: null }),
        item({ id: 'c' }),
      ]),
    ).active;
    assert.deepEqual(rows.map((row) => row.customSplit), [true, true, false]);
    assert.match(rows[0].label, /この固定費だけ負担を変えています/);
  });

  it('知らないカテゴリ・メンバーでも、崩れずに出す', () => {
    const [row] = buildRecurringSections(data([item({ categoryId: 'zzz', payerMemberId: 'zzz', description: null })])).active;
    assert.equal(row.title, '不明なカテゴリ');
    assert.equal(row.categoryColor, 'gray');
    assert.match(row.detailText, /支払う人 /);
  });

  it('固定費が無ければ、どの区分も空', () => {
    assert.deepEqual(buildRecurringSections(data([])), { paused: [], active: [], ended: [] });
  });
});

describe('describeSplit', () => {
  const nameOf = (id: string) => (id === 'm1' ? 'あなた' : id === 'm2' ? '彼女' : '不明');
  const money = (value: number) => `¥${value.toLocaleString('en-US')}`;

  it('負担の指定を、入力した値のまま、文にする', () => {
    assert.equal(describeSplit({ method: 'category' }, nameOf, money), 'カテゴリの割合で分けます');
    assert.equal(describeSplit({ method: 'equal', memberIds: ['m1', 'm2'] }, nameOf, money), 'あなた、彼女で均等に分けます');
    assert.equal(
      describeSplit({ method: 'ratio', shares: [{ memberId: 'm1', basisPoints: 6667 }, { memberId: 'm2', basisPoints: 3333 }] }, nameOf, money),
      'あなた 66.67%、彼女 33.33%',
    );
    assert.equal(
      describeSplit({ method: 'fixed', amounts: [{ memberId: 'm1', amountMinor: 50000 }, { memberId: 'm2', amountMinor: 30000 }] }, nameOf, money),
      'あなた ¥50,000、彼女 ¥30,000',
    );
    assert.equal(describeSplit({ method: 'single', memberId: 'm2' }, nameOf, money), '彼女が全額負担します');
  });
});
