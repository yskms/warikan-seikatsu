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
  payerRecurringNote,
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
    assert.equal(section.deletesGroup, false, '警告を出していないので、確認の申告は付けない');
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
    assert.equal(section.deletesGroup, true, '警告を出したので、送るときに確認の申告を付ける');
  });

  it('最後の1人かは、人数ではなく、サーバーの値だけで決める（1人だけのグループでも、値が false なら普通の文言）', () => {
    const solo = { memberId: 'm1', leaveDeletesGroup: false, members: [member({ id: 'm1', isMe: true })] };
    const section = buildLeaveSection(solo);
    assert.equal(section.kind === 'request' && section.buttonLabel, LEAVE_BUTTON_LABEL);
  });

  it('脱退を選んでいて、まだ確定していなければ、「脱退を取り消す」を出す。最後の1人なら、警告も添える', () => {
    const normal = buildLeaveSection(group({ leaveRequestedMonth: '2026-11' }));
    assert.deepEqual(normal, {
      kind: 'cancel',
      buttonLabel: CANCEL_LEAVE_BUTTON_LABEL,
      note: '取り消すと、このグループに残ります。',
      payerNote: null,
    });
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

describe('固定費の支払う人の添え書き', () => {
  it('名前が無ければ出さない。1件・2件はそのまま、3件以上は「ほかN件」', () => {
    assert.equal(payerRecurringNote([], 'request'), null);
    const one = payerRecurringNote(['家賃'], 'cancel');
    assert.ok(one?.startsWith('家賃の固定費は、支払う人を選び直す必要があります。'));
    assert.ok(one?.includes('脱退が確定すると、選び直していない固定費は自動登録が止まります。'));
    assert.ok(one?.includes('確定する前に、設定の「固定費」から選び直してください。'));
    assert.ok(payerRecurringNote(['家賃', '光熱費'], 'cancel')?.startsWith('家賃、光熱費の固定費は、'));
    assert.ok(payerRecurringNote(['家賃', '光熱費', 'ネット', '保険'], 'cancel')?.startsWith('家賃、光熱費ほか2件の固定費は、'));
  });

  it('同じ題は1つにまとめる（内容が無い同じカテゴリの固定費が2件でも、「家賃、家賃」と並べない）', () => {
    assert.ok(payerRecurringNote(['家賃', '家賃'], 'cancel')?.startsWith('家賃の固定費は、'));
    assert.ok(payerRecurringNote(['家賃', '光熱費', '家賃', '光熱費', 'ネット'], 'cancel')?.startsWith('家賃、光熱費ほか1件の固定費は、'));
  });

  it('脱退を選ぶ前だけ、「今月をすでに締めている場合は、脱退する前に選び直してください」を添える（脱退を選んだ時点で確定するため）', () => {
    const request = payerRecurringNote(['家賃'], 'request') ?? '';
    const cancel = payerRecurringNote(['家賃'], 'cancel') ?? '';
    assert.ok(request.includes('今月をすでに締めている場合は、脱退を選ぶとすぐ確定するので、脱退する前に選び直してください。'));
    assert.ok(!cancel.includes('今月をすでに締めている'), '脱退を選んだあとは、確定していないので、添えない');
    const confirm = payerRecurringNote(['家賃'], 'confirm') ?? '';
    assert.ok(!confirm.includes('今月をすでに締めている'), '確認の本文には、すでに同じ説明があるので、繰り返さない');
  });

  it('脱退を選ぶ前は、欄と確認の本文の両方に添える', () => {
    const section = buildLeaveSection(group({}), ['家賃']);
    assert.equal(section.kind, 'request');
    if (section.kind !== 'request') return;
    assert.ok(section.payerNote?.startsWith('家賃の固定費は、支払う人を選び直す必要があります。'));
    assert.ok(section.payerNote?.includes('脱退する前に選び直してください'));
    // 確認の本文は、直前の「今月をすでに締めている場合は、すぐに確定します。」と重ならないよう、最後の1文を省いた同じ内容
    const confirmNote = payerRecurringNote(['家賃'], 'confirm') ?? '?';
    assert.ok(section.confirm.message.includes(confirmNote));
    assert.ok(section.payerNote?.startsWith(confirmNote));
    assert.equal(section.confirm.message.match(/今月をすでに締めている場合は/g)?.length, 1, '同じ説明を2回出さない');
    assert.ok(section.confirm.message.includes('確定するまでは、取り消せます'), '元の文言は残る');
  });

  it('脱退を選んで、まだ確定していないあいだも、欄に添える（確定する前なら、選び直せる）', () => {
    const section = buildLeaveSection(group({ leaveRequestedMonth: '2026-11' }), ['家賃']);
    assert.equal(section.kind, 'cancel');
    assert.ok(section.kind === 'cancel' && section.payerNote?.startsWith('家賃の固定費は、'));
  });

  it('固定費が無い（または読めなかった）ときは、添えない。確認の本文も変わらない', () => {
    const plain = buildLeaveSection(group({}));
    assert.equal(plain.kind === 'request' && plain.payerNote, null);
    const empty = buildLeaveSection(group({}), []);
    assert.deepEqual(empty, plain);
  });

  it('最後の1人（グループごと消える）ときは、添えない（固定費も一緒に消える）', () => {
    const last = buildLeaveSection(group({}, true), ['家賃']);
    assert.equal(last.kind === 'request' && last.payerNote, null);
    assert.ok(last.kind === 'request' && !last.confirm.message.includes('固定費'));
    const lastCancel = buildLeaveSection(group({ leaveRequestedMonth: '2026-11' }, true), ['家賃']);
    assert.equal(lastCancel.kind === 'cancel' && lastCancel.payerNote, null);
  });

  it('欄を出さない人には、固定費があっても出さない', () => {
    assert.deepEqual(buildLeaveSection(group({ leaveEffective: true }), ['家賃']), { kind: 'hidden' });
  });
});
