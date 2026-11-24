// メンバーと招待の画面に出す内容の組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupMember } from '../domain/group.ts';
import {
  buildInviteSection,
  buildMemberList,
  formatInviteExpiry,
  memberStatusLabel,
  sortInvites,
  isInviteExpired,
} from './memberView.ts';

function member(overrides: Partial<GroupMember> & { id: string }): GroupMember {
  return {
    displayName: overrides.id,
    color: 'pink',
    status: 'active',
    historyFromMonth: '2026-11',
    leaveRequestedMonth: null,
    expenseEndMonth: null,
    leaveEffective: false,
    isMe: false,
    ...overrides,
  };
}

describe('memberStatusLabel', () => {
  const label = (status: GroupMember['status'], leaveRequestedMonth: string | null, leaveEffective = false) =>
    memberStatusLabel({ status, leaveRequestedMonth, leaveEffective });

  it('参加中（脱退を選んでいない）は、何も添えない', () => {
    assert.equal(label('active', null), null);
  });

  it('脱退を選んだだけの人は、月と、確定する日を添える', () => {
    assert.equal(label('active', '2026-06'), '6月で脱退予定（6月を締めるか、7月1日に確定）');
    assert.equal(label('active', '2026-12'), '12月で脱退予定（12月を締めるか、1月1日に確定）');
  });

  it('脱退月が終わった人（サーバーが確定したものとして扱う。Cronの確定の前）は、「脱退予定」と出さない', () => {
    assert.equal(label('active', '2026-06', true), '6月で脱退が確定');
    // 確定の日付は、すでに過ぎているので出さない
    assert.doesNotMatch(label('active', '2026-06', true) ?? '', /1日/);
  });

  it('脱退が確定した人・脱退済みの人', () => {
    assert.equal(label('leaving', '2026-06', true), '脱退が確定（精算が残っています）');
    assert.equal(label('left', '2026-06', true), '脱退済み');
  });

  it('削除したユーザーは、名前（サーバーが匿名にしている）に任せて、何も添えない', () => {
    assert.equal(label('deleted', null, true), null);
  });

  it('知らない状態は、何も添えない', () => {
    assert.equal(label('unknown', null), null);
    assert.equal(label('unknown', null, true), null);
  });
});

describe('buildMemberList', () => {
  it('いる人（自分が先）と、以前の人に分ける。サーバーの並びは保つ', () => {
    const list = buildMemberList([
      member({ id: 'a', displayName: 'あかり' }),
      member({ id: 'b', displayName: 'ゆうき', isMe: true }),
      member({ id: 'c', displayName: 'さとし', status: 'left' }),
      member({ id: 'd', displayName: '削除されたユーザー', status: 'deleted' }),
      member({ id: 'e', displayName: 'みなみ', status: 'leaving', leaveRequestedMonth: '2026-10' }),
    ]);
    assert.deepEqual(list.current.map((row) => row.id), ['b', 'a', 'e']);
    assert.deepEqual(list.former.map((row) => row.id), ['c', 'd']);
  });

  it('行に、頭文字・色・自分かどうか・状態を載せる', () => {
    const [row] = buildMemberList([member({ id: 'a', displayName: 'あかり', color: 'teal', isMe: true })]).current;
    assert.deepEqual(row, { id: 'a', name: 'あかり', initial: 'あ', color: 'teal', isMe: true, statusLabel: null });
  });

  it('知らない状態の人は、いる人として出す（一覧から消さない）', () => {
    const list = buildMemberList([member({ id: 'a', status: 'unknown' })]);
    assert.equal(list.current.length, 1);
    assert.equal(list.former.length, 0);
  });

  it('メンバーがいなくても落ちない', () => {
    assert.deepEqual(buildMemberList([]), { current: [], former: [] });
  });
});

describe('buildInviteSection', () => {
  const base = { memberId: 'me', canInvite: true, seatedMembers: 2, maxMembers: 5 };
  const members = (status: GroupMember['status'], leaveEffective = false) => [member({ id: 'me', isMe: true, status, leaveEffective })];

  it('招待できるとき（サーバーの canInvite）は、理由を添えない', () => {
    assert.deepEqual(buildInviteSection({ ...base, members: members('active') }), { visible: true, canInvite: true, note: null });
  });

  it('満員のときは、上限の人数を添える（人数は、サーバーの値）', () => {
    assert.deepEqual(
      buildInviteSection({ ...base, members: members('active'), canInvite: false, seatedMembers: 5 }),
      { visible: true, canInvite: false, note: '1つのグループは5人までです。' },
    );
  });

  it('満員でなく、招待できないときは、一般的な理由', () => {
    assert.deepEqual(
      buildInviteSection({ ...base, members: members('active'), canInvite: false }),
      { visible: true, canInvite: false, note: 'いまは、招待できません。' },
    );
  });

  it('canInvite が true なら、人数の値が合わなくても true のまま（人数の判定をアプリに持たない）', () => {
    assert.equal(buildInviteSection({ ...base, members: members('active'), seatedMembers: 5 }).canInvite, true);
  });

  it('自分の脱退が確定したものとして扱われているときは、欄を出さない（status が leaving 以降の人）', () => {
    for (const status of ['leaving', 'left', 'deleted'] as const) {
      assert.deepEqual(buildInviteSection({ ...base, members: members(status, true), canInvite: false }), {
        visible: false,
        canInvite: false,
        note: null,
      });
    }
  });

  it('脱退月が終わった（Cronの確定の前。status は active のまま）自分も、欄を出さない。「いまは、招待できません。」とは出さない', () => {
    const me = member({ id: 'me', isMe: true, leaveRequestedMonth: '2026-10', leaveEffective: true });
    assert.deepEqual(buildInviteSection({ ...base, members: [me], canInvite: false }), {
      visible: false,
      canInvite: false,
      note: null,
    });
  });

  it('他の人の脱退が確定していても、自分の欄には関係しない', () => {
    const other = member({ id: 'other', status: 'leaving', leaveEffective: true });
    assert.equal(buildInviteSection({ ...base, members: [member({ id: 'me', isMe: true }), other] }).visible, true);
  });

  it('自分を見つけられない・自分の状態が分からないときも、サーバーの canInvite に従って欄を出す', () => {
    assert.equal(buildInviteSection({ ...base, members: [] }).visible, true);
    assert.equal(buildInviteSection({ ...base, members: members('unknown') }).visible, true);
  });

  it('脱退を選んだだけ（active）の人は、サーバーが許せば、招待できる', () => {
    const me = member({ id: 'me', isMe: true, leaveRequestedMonth: '2026-11' });
    assert.equal(buildInviteSection({ ...base, members: [me] }).canInvite, true);
  });
});

describe('formatInviteExpiry', () => {
  const now = 1_790_000_000_000;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  it('1日以上: 日と時間', () => {
    assert.equal(formatInviteExpiry(now + 3 * day, now), 'あと3日');
    assert.equal(formatInviteExpiry(now + 2 * day + 5 * hour + 59 * minute, now), 'あと2日5時間');
  });

  it('発行した直後（期限まで3日）は、数秒の差で「あと2日23時間」にならない（分は切り上げる）', () => {
    assert.equal(formatInviteExpiry(now + 3 * day - 5000, now), 'あと3日');
    assert.equal(formatInviteExpiry(now + 3 * day - minute, now), 'あと2日23時間');
  });

  it('1日未満: 時間、分', () => {
    assert.equal(formatInviteExpiry(now + 23 * hour + 59 * minute, now), 'あと23時間');
    assert.equal(formatInviteExpiry(now + hour, now), 'あと1時間');
    assert.equal(formatInviteExpiry(now + 59 * minute, now), 'あと59分');
    assert.equal(formatInviteExpiry(now + minute, now), 'あと1分');
  });

  it('1分未満・期限が来た・過ぎた', () => {
    assert.equal(formatInviteExpiry(now + 59_999, now), 'まもなく期限切れ');
    assert.equal(formatInviteExpiry(now, now), '期限切れ');
    assert.equal(formatInviteExpiry(now - day, now), '期限切れ');
  });
});

describe('sortInvites', () => {
  it('新しく発行したものが上。元の配列は変えない', () => {
    const invites = [
      { id: 'a', expiresAt: 3, createdAt: 1 },
      { id: 'c', expiresAt: 5, createdAt: 3 },
      { id: 'b', expiresAt: 4, createdAt: 2 },
    ];
    assert.deepEqual(sortInvites(invites).map((invite) => invite.id), ['c', 'b', 'a']);
    assert.deepEqual(invites.map((invite) => invite.id), ['a', 'c', 'b']);
  });

  it('発行時刻が同じときは、IDの順（並びを安定させる）', () => {
    const invites = [
      { id: 'b', expiresAt: 3, createdAt: 1 },
      { id: 'a', expiresAt: 3, createdAt: 1 },
    ];
    assert.deepEqual(sortInvites(invites).map((invite) => invite.id), ['a', 'b']);
  });
});

describe('isInviteExpired', () => {
  const now = 1_000;
  it('期限を過ぎた・期限ちょうどは切れている。まだ先なら切れていない（端末の時計での判定）', () => {
    assert.equal(isInviteExpired({ expiresAt: now - 1 }, now), true);
    assert.equal(isInviteExpired({ expiresAt: now }, now), true);
    assert.equal(isInviteExpired({ expiresAt: now + 1 }, now), false);
  });
});
