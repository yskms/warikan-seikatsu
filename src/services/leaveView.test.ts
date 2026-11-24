// 脱退を選ぶ・取り消す操作の欄の組み立てのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupMember } from '../domain/group.ts';
import {
  buildLeaveSection,
  CANCEL_LEAVE_BUTTON_LABEL,
  LEAVE_AND_DELETE_BUTTON_LABEL,
  LEAVE_BUTTON_LABEL,
} from './leaveView.ts';

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

function group(me: Partial<GroupMember>, leaveDeletesGroup = false) {
  return {
    memberId: 'm1',
    leaveDeletesGroup,
    members: [member({ id: 'm1', isMe: true, ...me }), member({ id: 'm2' })],
  };
}

describe('buildLeaveSection', () => {
  it('脱退を選んでいない参加中の人には、「脱退する」と確認の内容を出す', () => {
    const section = buildLeaveSection(group({}));
    assert.equal(section.kind, 'request');
    if (section.kind !== 'request') return;
    assert.equal(section.buttonLabel, LEAVE_BUTTON_LABEL);
    assert.equal(section.confirm.title, 'このグループから脱退しますか？');
    assert.equal(section.confirm.confirmLabel, '脱退する');
    assert.ok(section.confirm.message.includes('確定するまでは、取り消せます'));
    assert.ok(!section.confirm.message.includes('削除'), '残る人がいるときは、削除に触れない');
  });

  it('最後の1人（サーバーの leaveDeletesGroup）なら、「グループを削除して脱退」と、削除の警告を出す', () => {
    const section = buildLeaveSection(group({}, true));
    assert.equal(section.kind, 'request');
    if (section.kind !== 'request') return;
    assert.equal(section.buttonLabel, LEAVE_AND_DELETE_BUTTON_LABEL);
    assert.equal(section.confirm.title, 'グループを削除して脱退しますか？');
    assert.equal(section.confirm.confirmLabel, 'グループを削除して脱退');
    assert.ok(section.confirm.message.includes('すべて削除され、元に戻せません'));
    assert.ok(section.note.includes('すべて削除され、元に戻せません'));
  });

  it('最後の1人かは、人数ではなく、サーバーの値だけで決める（1人だけのグループでも、値が false なら普通の文言）', () => {
    const solo = { memberId: 'm1', leaveDeletesGroup: false, members: [member({ id: 'm1', isMe: true })] };
    const section = buildLeaveSection(solo);
    assert.equal(section.kind === 'request' && section.buttonLabel, LEAVE_BUTTON_LABEL);
  });

  it('脱退を選んでいて、まだ確定していなければ、「脱退を取り消す」を出す。最後の1人なら、警告も添える', () => {
    const normal = buildLeaveSection(group({ leaveRequestedMonth: '2026-11' }));
    assert.deepEqual(normal, { kind: 'cancel', buttonLabel: CANCEL_LEAVE_BUTTON_LABEL, note: '取り消すと、このグループに残ります。' });
    const last = buildLeaveSection(group({ leaveRequestedMonth: '2026-11' }, true));
    assert.equal(last.kind, 'cancel');
    assert.ok(last.kind === 'cancel' && last.note.includes('すべて削除され、元に戻せません'));
  });

  it('脱退が確定したものとして扱われる人（leaveEffective）には出さない。active のまま脱退月が終わった人も同じ', () => {
    assert.deepEqual(buildLeaveSection(group({ leaveRequestedMonth: '2026-10', leaveEffective: true })), { kind: 'hidden' });
    assert.deepEqual(buildLeaveSection(group({ status: 'leaving', leaveEffective: true })), { kind: 'hidden' });
  });

  it('参加中でない人・知らない状態の人・自分が見つからないときは、出さない', () => {
    assert.deepEqual(buildLeaveSection(group({ status: 'unknown' })), { kind: 'hidden' });
    assert.deepEqual(buildLeaveSection(group({ status: 'left', leaveEffective: true })), { kind: 'hidden' });
    assert.deepEqual(buildLeaveSection({ memberId: 'nobody', leaveDeletesGroup: false, members: [member({ id: 'm1' })] }), { kind: 'hidden' });
  });
});
