// 締めの確認のシートに出す内容の組み立てのテスト。`npm test` で実行する。精算の計算や、締められるかの判断は、ここでは
// 確かめない（サーバーの答えに従うだけ）。応答の値を、表示する形にすることと、注意書きの出し分けを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail, GroupMember } from '../domain/group.ts';
import type { MonthList, MonthView } from '../domain/month.ts';
import { ALREADY_CLOSED_TEXT, buildCloseConfirm, CLOSE_NOTICE } from './closeView.ts';

const member = (id: string, displayName: string, patch: Partial<GroupMember> = {}): GroupMember => ({
  id,
  displayName,
  color: 'pink',
  status: 'active',
  historyFromMonth: '2026-10',
  leaveRequestedMonth: null,
  expenseEndMonth: null,
  isMe: id === 'm1',
  ...patch,
});

const baseGroup: GroupDetail = {
  id: 'g1',
  name: 'ふたりの生活費',
  currencyCode: 'JPY',
  currencyMinorUnit: 0,
  timezone: 'Asia/Tokyo',
  createdAt: 0,
  memberId: 'm1',
  currencyLocked: false,
  seatedMembers: 2,
  maxMembers: 5,
  canInvite: true,
  members: [member('m1', 'あなた'), member('m2', '彼女')],
};

const summaryMember = (memberId: string, displayName: string, patch: Partial<MonthView['members'][number]> = {}) => ({
  memberId,
  displayName,
  paidMinor: 0,
  burdenMinor: 0,
  differenceMinor: 0,
  carriedInMinor: 0,
  netMinor: 0,
  ...patch,
});

const estimate = (patch: Partial<MonthView> = {}): MonthView => ({
  month: '2026-11',
  closed: false,
  closing: null,
  totalMinor: 14000,
  members: [summaryMember('m1', 'あなた'), summaryMember('m2', '彼女')],
  categories: [],
  transfers: [{ kind: 'estimate', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 13450 }],
  close: { closable: true },
  ...patch,
});

const monthList = (currentMonth: string): MonthList => ({ currentMonth, months: [] });

describe('buildCloseConfirm', () => {
  it('締められる月: 確定する送金（向き・金額）と、締めた後の制限を出す', () => {
    const model = buildCloseConfirm({ group: baseGroup, months: monthList('2026-12'), summary: estimate() });
    assert.equal(model.title, '11月を締める');
    assert.equal(model.state, 'ready');
    assert.equal(model.statusText, null);
    assert.deepEqual(model.lines.map((line) => [line.fromName, line.toName, line.amountText]), [['彼女', 'あなた', '¥13,450']]);
    assert.equal(model.emptyText, null);
    assert.equal(model.notice, CLOSE_NOTICE);
    assert.equal(model.midMonthNote, null);
    assert.deepEqual(model.leaveNotes, []);
  });

  it('送金が無いときは、その旨を出す', () => {
    const model = buildCloseConfirm({ group: baseGroup, months: monthList('2026-12'), summary: estimate({ transfers: [] }) });
    assert.equal(model.state, 'ready');
    assert.deepEqual(model.lines, []);
    assert.equal(model.emptyText, 'いまのところ精算はありません');
  });

  it('先月からの繰越を含むときは、その額を添える', () => {
    const model = buildCloseConfirm({
      group: baseGroup,
      months: monthList('2026-12'),
      summary: estimate({ members: [summaryMember('m1', 'あなた', { carriedInMinor: 5000 }), summaryMember('m2', '彼女', { carriedInMinor: -5000 })] }),
    });
    assert.equal(model.carryNote, '先月からの繰越 ¥5,000 を含みます');
  });

  it('いまが、その月の途中なら、残りの支出は次の月に登録することを添える（年をまたぐときも）', () => {
    const now = buildCloseConfirm({ group: baseGroup, months: monthList('2026-11'), summary: estimate() });
    assert.equal(now.midMonthNote, 'まだ月の途中です。この月の残りの支出は、12月分として登録します。');
    const december = buildCloseConfirm({
      group: baseGroup,
      months: monthList('2026-12'),
      summary: estimate({ month: '2026-12' }),
    });
    assert.equal(december.midMonthNote, 'まだ月の途中です。この月の残りの支出は、1月分として登録します。');
    // 終わった月（今月より前）を締めるときは、出さない
    const past = buildCloseConfirm({ group: baseGroup, months: monthList('2026-12'), summary: estimate({ month: '2026-11' }) });
    assert.equal(past.midMonthNote, null);
  });

  it('この月を脱退月に選んでいるメンバー（参加中）は、脱退が確定することを、1人ずつ添える', () => {
    const group: GroupDetail = {
      ...baseGroup,
      members: [
        member('m1', 'あなた'),
        member('m2', '彼女', { leaveRequestedMonth: '2026-11' }),
        // 脱退月を過ぎたのに、まだ確定していない（月初のCronの前）。この締めで確定する
        member('m3', 'ゆう', { leaveRequestedMonth: '2026-10' }),
        // 先の月に脱退を選んでいる人は、この月の締めでは確定しない
        member('m4', 'はる', { leaveRequestedMonth: '2026-12' }),
        // すでに確定した人（`leaving`・`left`）には出さない
        member('m5', 'みお', { status: 'leaving', leaveRequestedMonth: '2026-11' }),
        member('m6', 'りく', { status: 'left', leaveRequestedMonth: '2026-10' }),
      ],
    };
    const model = buildCloseConfirm({ group, months: monthList('2026-12'), summary: estimate() });
    assert.deepEqual(model.leaveNotes, [
      '彼女さんの脱退は、この月を締めると確定します。',
      'ゆうさんの脱退は、この月を締めると確定します。',
    ]);
  });

  it('自分が脱退を選んでいるときは、「あなた」と言う', () => {
    const group: GroupDetail = {
      ...baseGroup,
      members: [member('m1', 'あなた', { leaveRequestedMonth: '2026-11' }), member('m2', '彼女', { leaveRequestedMonth: '2026-11' })],
    };
    const model = buildCloseConfirm({ group, months: monthList('2026-12'), summary: estimate() });
    assert.deepEqual(model.leaveNotes, [
      'あなたの脱退は、この月を締めると確定します。',
      '彼女さんの脱退は、この月を締めると確定します。',
    ]);
  });

  it('いまは締められない月（サーバーの答え）は、理由を出して、締められない状態にする', () => {
    const model = buildCloseConfirm({
      group: baseGroup,
      months: monthList('2026-12'),
      summary: estimate({ close: { closable: false, reason: 'previous_month_unsettled', month: '2026-10' } }),
    });
    assert.equal(model.state, 'blocked');
    assert.equal(model.statusText, '先に10月分の精算を済ませてください');
    // 送金の見込みは、そのまま出す（理由を読んで、閉じられる）
    assert.equal(model.lines.length, 1);
  });

  it('知らない理由でも、締められない状態にして、文言を出す', () => {
    const model = buildCloseConfirm({
      group: baseGroup,
      months: monthList('2026-12'),
      summary: estimate({ close: { closable: false, reason: 'unknown', month: null } }),
    });
    assert.equal(model.state, 'blocked');
    assert.equal(model.statusText, 'いまは、この月を締められません');
  });

  it('開いているあいだに、ほかのメンバーが先に締めたとき（締めた月の結果が届く）は、締めさせない', () => {
    const closed = estimate({
      closed: true,
      closing: { id: 'cl1', closedAt: 0, closedByMemberId: 'm2', processed: false },
      transfers: [{ kind: 'closed', id: 't1', fromMemberId: 'm2', toMemberId: 'm1', amountMinor: 13450, status: 'pending', canCarry: true }],
      close: { closable: false, reason: 'month_closed', month: null },
    });
    const model = buildCloseConfirm({
      group: { ...baseGroup, members: [member('m1', 'あなた', { leaveRequestedMonth: '2026-11' }), member('m2', '彼女')] },
      months: monthList('2026-11'),
      summary: closed,
    });
    assert.equal(model.state, 'closed');
    assert.equal(model.statusText, ALREADY_CLOSED_TEXT);
    // 締めた結果の送金や、月の途中・脱退の注意は、出さない（確認の対象ではない）
    assert.deepEqual(model.lines, []);
    assert.equal(model.midMonthNote, null);
    assert.deepEqual(model.leaveNotes, []);
  });

  it('文言に長いダッシュを含まない', () => {
    const texts = [CLOSE_NOTICE, ALREADY_CLOSED_TEXT];
    for (const text of texts) assert.ok(!/[—―⸺⸻]/.test(text), text);
  });
});
