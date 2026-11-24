// 脱退を選ぶ・取り消すの失敗の文言と、読み直しの判断のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { GroupRejectedError } from '../repositories/groupRepository.ts';
import {
  leaveDone,
  leaveErrorMessage,
  leaveLostGroup,
  leaveOutcome,
  leaveResultUnknown,
  shouldReloadAfterLeave,
} from './leaveMessage.ts';

const rejected = (reason: string | null, status = 409) => new GroupRejectedError(status, reason);

describe('leaveErrorMessage', () => {
  it('操作ごとに、書き出しを変える', () => {
    assert.ok(leaveErrorMessage(new AuthError('unavailable'), 'request').startsWith('脱退を選べませんでした。'));
    assert.ok(leaveErrorMessage(new AuthError('unavailable'), 'cancel').startsWith('脱退を取り消せませんでした。'));
  });

  it('通信・サーバー・セッションの失敗', () => {
    assert.ok(leaveErrorMessage(new AuthError('network'), 'request').includes('通信できませんでした'));
    assert.ok(leaveErrorMessage(new AuthError('unavailable'), 'request').includes('混み合っています'));
    assert.ok(leaveErrorMessage(new AuthError('unauthorized'), 'request').includes('ログイン'));
    assert.ok(leaveErrorMessage(new AuthError('storage-failed'), 'request').includes('この端末に保存したログイン情報'));
  });

  it('サーバーが断った理由ごとの文言', () => {
    assert.ok(leaveErrorMessage(rejected('leave_already_requested'), 'request').includes('すでに脱退を選んでいます'));
    assert.ok(leaveErrorMessage(rejected('leave_confirmed'), 'request').includes('すでに脱退が確定しています'));
    assert.ok(leaveErrorMessage(rejected('leave_confirmed'), 'cancel').includes('すでに脱退が確定しています'));
    assert.ok(leaveErrorMessage(rejected('not_leaving'), 'cancel').includes('脱退は選んでいません'));
    assert.ok(leaveErrorMessage(rejected('not_found', 404), 'request').includes('グループの状態が変わったかもしれません'));
    assert.ok(leaveErrorMessage(rejected('conflict'), 'request').includes('他の操作と重なりました'));
    assert.ok(leaveErrorMessage(rejected('something_new'), 'request').includes('最新の版に更新'));
    assert.ok(leaveErrorMessage(rejected(null, 403), 'request').includes('最新の版に更新'));
  });

  it('応答が読めない（invalid-response）は、通信環境の可能性を添える。それ以外は、時間をおいて', () => {
    assert.ok(leaveErrorMessage(new AuthError('invalid-response'), 'request').includes('Wi-Fiの認証画面'));
    assert.ok(leaveErrorMessage(new Error('x'), 'request').includes('時間をおいて'));
    const codes: AuthErrorCode[] = ['invalid-request', 'unexpected'];
    for (const code of codes) assert.ok(leaveErrorMessage(new AuthError(code), 'request').includes('時間をおいて'));
  });

  it('エラーの message・URL・セッションを、画面の文言に載せない', () => {
    const text = leaveErrorMessage(new AuthError('network', 'https://secret.example/groups/g1/leave'), 'request');
    assert.ok(!text.includes('secret'));
  });
});

describe('読み直しの判断', () => {
  it('サーバーが断ったら、いつも読み直す。競合（conflict）も（他のメンバーの書き込みで、最後の1人かの警告が古くなりうる）', () => {
    assert.equal(shouldReloadAfterLeave(rejected('leave_confirmed')), true);
    assert.equal(shouldReloadAfterLeave(rejected('leave_already_requested')), true);
    assert.equal(shouldReloadAfterLeave(rejected('not_leaving')), true);
    assert.equal(shouldReloadAfterLeave(rejected('not_found', 404)), true);
    assert.equal(shouldReloadAfterLeave(rejected('conflict')), true);
    assert.equal(shouldReloadAfterLeave(rejected('delete_not_acknowledged')), true);
    assert.equal(shouldReloadAfterLeave(new AuthError('network')), false, '通信の失敗は、読み直しても同じ失敗になりうる');
  });

  it('確認の申告が無いまま消えることになった（delete_not_acknowledged）ときは、確認し直す案内を出す', () => {
    const text = leaveErrorMessage(rejected('delete_not_acknowledged'), 'request');
    assert.ok(text.includes('グループのデータがすべて削除されることになりました'));
    assert.ok(text.includes('確認し直してください'));
  });

  it('グループが無い（404 not_found）ときだけ、所属グループの一覧も読み直す', () => {
    assert.equal(leaveLostGroup(rejected('not_found', 404)), true);
    assert.equal(leaveLostGroup(rejected('conflict')), false);
    assert.equal(leaveLostGroup(new AuthError('network')), false);
  });

  it('結果が分からない失敗（断られていない）は、読み直して確かめる', () => {
    assert.equal(leaveResultUnknown(new AuthError('network')), true);
    assert.equal(leaveResultUnknown(new AuthError('invalid-response')), true);
    assert.equal(leaveResultUnknown(rejected('conflict')), false);
  });
});

describe('結果の案内', () => {
  it('確定するまで取り消せる状態（requested）は案内を出さない。確定・グループが消えたときだけ出す', () => {
    assert.equal(leaveOutcome({ confirmed: false, groupDeleted: false }), 'requested');
    assert.equal(leaveOutcome({ confirmed: true, groupDeleted: false }), 'confirmed');
    assert.equal(leaveOutcome({ confirmed: true, groupDeleted: true }), 'group-deleted');
    assert.equal(leaveOutcome({ confirmed: false, groupDeleted: true }), 'group-deleted');
    assert.equal(leaveDone('requested'), null);
    assert.equal(leaveDone('confirmed')?.title, '脱退しました');
    assert.ok(leaveDone('group-deleted')?.message.includes('元に戻すことはできません'));
  });
});
