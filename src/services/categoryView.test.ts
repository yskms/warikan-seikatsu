// カテゴリと負担割合の画面に出す内容の組み立てのテスト。`npm test` で実行する。計算（負担額・端数の配り方）は、ここでは
// 確かめない（Workerだけが計算する）。応答の値を、表示する形にすることだけを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CategoryShareRule, CategoryShares } from '../domain/categoryShare.ts';
import type { GroupMember } from '../domain/group.ts';
import type { Category, MonthListItem } from '../domain/month.ts';
import {
  buildCategoryRows,
  buildShareMonthOptions,
  capTextOf,
  orderShareMembers,
  pickShareMonth,
  splitArchived,
} from './categoryView.ts';

const months: MonthListItem[] = [
  { month: '2026-09', status: 'settled' },
  { month: '2026-10', status: 'unsettled' },
  { month: '2026-11', status: 'open' },
  { month: '2026-12', status: 'open' },
];

describe('pickShareMonth', () => {
  it('選びたい月（ホームで見ている月）が、締めていない月なら、それ', () => {
    assert.equal(pickShareMonth(months, '2026-11', '2026-12'), '2026-12');
  });

  it('選びたい月が、締めた月・一覧に無い月・指定なしなら、今月', () => {
    assert.equal(pickShareMonth(months, '2026-11', '2026-10'), '2026-11');
    assert.equal(pickShareMonth(months, '2026-11', '2030-01'), '2026-11');
    assert.equal(pickShareMonth(months, '2026-11', null), '2026-11');
  });

  it('今月も選べなければ、締めていない月のうち、最も古い月', () => {
    const list: MonthListItem[] = [
      { month: '2026-10', status: 'open' },
      { month: '2026-11', status: 'settled' },
    ];
    assert.equal(pickShareMonth(list, '2026-11', null), '2026-10');
  });

  it('締めていない月が無ければ null。知らない状態の月は選ばない', () => {
    assert.equal(pickShareMonth([{ month: '2026-11', status: 'settled' }], '2026-11', null), null);
    assert.equal(pickShareMonth([{ month: '2026-11', status: 'unknown' }], '2026-11', null), null);
    assert.equal(pickShareMonth([], '2026-11', null), null);
  });
});

describe('buildShareMonthOptions', () => {
  it('締めていない月だけを、古い月から並べる。選んでいる月に印', () => {
    assert.deepEqual(buildShareMonthOptions(months, '2026-12'), [
      { month: '2026-11', label: '2026年11月', selected: false },
      { month: '2026-12', label: '2026年12月', selected: true },
    ]);
  });

  it('選んでいる月が無ければ、どれも選ばない', () => {
    assert.ok(buildShareMonthOptions(months, null).every((option) => !option.selected));
    assert.deepEqual(buildShareMonthOptions([], null), []);
  });
});

const member = (id: string, displayName: string, isMe = false): GroupMember => ({
  id,
  displayName,
  color: 'pink',
  status: 'active',
  historyFromMonth: '2026-10',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
  leaveEffective: false,
  isMe,
});

describe('orderShareMembers', () => {
  const members = [member('a', 'あや'), member('b', 'ぼん', true), member('c', 'ちか')];

  it('本人が先、あとはグループのメンバーの並び', () => {
    assert.deepEqual(orderShareMembers(['c', 'a', 'b'], members), ['b', 'a', 'c']);
  });

  it('割合に入らないメンバーは出さない', () => {
    assert.deepEqual(orderShareMembers(['a', 'b'], members), ['b', 'a']);
  });

  it('グループのメンバーに無いIDは、最後に、渡された順で付ける', () => {
    assert.deepEqual(orderShareMembers(['z', 'a', 'y', 'b'], members), ['b', 'a', 'z', 'y']);
  });
});

describe('splitArchived', () => {
  const category = (id: string, archived: boolean): Category => ({
    id,
    name: id,
    icon: 'cart',
    color: 'green',
    sortOrder: 1,
    archived,
  });

  it('アーカイブした費目を分ける。並びは保つ', () => {
    const result = splitArchived([category('a', false), category('b', true), category('c', false), category('d', true)]);
    assert.deepEqual(result.active.map((c) => c.id), ['a', 'c']);
    assert.deepEqual(result.archived.map((c) => c.id), ['b', 'd']);
  });
});

describe('buildCategoryRows', () => {
  const categories: Category[] = [
    { id: 'c1', name: '家賃', icon: 'home', color: 'blue', sortOrder: 1, archived: false },
    { id: 'c2', name: '外食', icon: 'utensils', color: 'orange', sortOrder: 2, archived: false },
    { id: 'c3', name: '新しい費目', icon: 'more', color: 'gray', sortOrder: 3, archived: false },
    { id: 'c4', name: '昔の費目', icon: 'cart', color: 'green', sortOrder: 4, archived: true },
  ];
  const rule = (categoryId: string, shares: [string, number][], cap: CategoryShareRule['cap'] = null): CategoryShareRule => ({
    categoryId,
    sourceMonth: '2026-10',
    shares: shares.map(([memberId, basisPoints]) => ({ memberId, basisPoints })),
    memberChangedAt: null,
    memberChangeKind: null,
    cap,
    archived: false,
  });
  const shares: CategoryShares = {
    month: '2026-11',
    closed: false,
    editable: true,
    memberIds: ['m1', 'm2'],
    categories: [
      // サーバーの順は、本人が先とは限らない
      rule('c1', [['m2', 3000], ['m1', 7000]]),
      rule('c2', [['m1', 0], ['m2', 10000]], { memberId: 'm1', capMinor: 10000 }),
      rule('c4', [['m1', 5000], ['m2', 5000]]),
    ],
  };
  const ctx = {
    memberOrder: ['m1', 'm2'],
    memberName: (memberId: string) => (memberId === 'm1' ? '自分' : '相手'),
    money: (amountMinor: number) => `¥${amountMinor.toLocaleString('en-US')}`,
  };

  it('割合は、表示順（本人が先）で出す', () => {
    const [rent] = buildCategoryRows(categories, shares, ctx);
    assert.equal(rent?.ratioText, '7:3');
    assert.equal(rent?.capText, null);
    assert.equal(rent?.summary, '家賃、7:3');
  });

  it('上限額つきは、上限の説明を出す（割合の文字は、その中に含める）', () => {
    const rows = buildCategoryRows(categories, shares, ctx);
    assert.equal(rows[1]?.capText, '月¥10,000まで自分、超えた分 0:10');
    assert.equal(rows[1]?.ratioText, null);
    assert.equal(rows[1]?.summary, '外食、月¥10,000まで自分、超えた分 0:10');
  });

  it('上限額つきで割合の行が空のときは、「超えた分」を付けない（末尾が欠けた文字にしない）', () => {
    const empty = shares.categories[1]!;
    const capped = { ...empty, shares: [] };
    assert.equal(capTextOf(capped, ctx), '月¥10,000まで自分');
    assert.equal(capTextOf({ ...capped, cap: null }, ctx), null);
    // 割合の文字を渡したときは、それを使う
    assert.equal(capTextOf(empty, ctx, '0:10（自分、相手の順）'), '月¥10,000まで自分、超えた分 0:10（自分、相手の順）');
  });

  it('その月に割合が無い費目（作る前の月）は、割合を出さない', () => {
    const rows = buildCategoryRows(categories, shares, ctx);
    assert.equal(rows[2]?.ratioText, null);
    assert.equal(rows[2]?.capText, null);
    assert.equal(rows[2]?.summary, '新しい費目');
  });

  it('アーカイブした費目も、割合があれば出す。見た目の項目はそのまま渡す', () => {
    const rows = buildCategoryRows(categories, shares, ctx);
    assert.equal(rows[3]?.archived, true);
    assert.equal(rows[3]?.ratioText, '5:5');
    assert.equal(rows[3]?.icon, 'cart');
    assert.equal(rows[3]?.color, 'green');
  });

  it('割合を読めていない（`shares` が null）あいだは、費目の名前だけ', () => {
    const rows = buildCategoryRows(categories, null, ctx);
    assert.deepEqual(rows.map((row) => row.ratioText), [null, null, null, null]);
    assert.deepEqual(rows.map((row) => row.summary), ['家賃', '外食', '新しい費目', '昔の費目']);
  });

  it('3人のときは、%を並べる。均等にリセットした割合は「均等」', () => {
    const three: CategoryShares = {
      ...shares,
      memberIds: ['m1', 'm2', 'm3'],
      categories: [rule('c1', [['m1', 4000], ['m2', 3000], ['m3', 3000]]), rule('c2', [['m3', 3333], ['m2', 3333], ['m1', 3334]])],
    };
    const rows = buildCategoryRows(categories, three, { ...ctx, memberOrder: ['m1', 'm2', 'm3'] });
    assert.equal(rows[0]?.ratioText, '40% / 30% / 30%');
    assert.equal(rows[1]?.ratioText, '均等');
  });
});
