// 招待の失敗の文言と、読み直しの判断のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { InviteRejectedError } from '../repositories/inviteRepository.ts';
import {
  issueInviteErrorMessage,
  resultUnknown,
  revokeInviteErrorMessage,
  shouldReloadAfter,
} from './inviteMessage.ts';

const rejected = (status: number, reason: string | null) => new InviteRejectedError(status, reason);

describe('issueInviteErrorMessage', () => {
  it('どの文言も、「招待を作れませんでした」から始まる（成功と取り違えない）', () => {
    const errors = [
      new AuthError('network'),
      new AuthError('unavailable'),
      new AuthError('invalid-request'),
      new AuthError('invalid-response'),
      new AuthError('unexpected'),
      new Error('x'),
      rejected(409, 'group_full'),
      rejected(409, 'too_many_invites'),
      rejected(403, 'forbidden'),
      rejected(404, 'not_found'),
      rejected(409, 'conflict'),
      rejected(409, null),
      rejected(409, 'something_new'),
    ];
    for (const error of errors) assert.match(issueInviteErrorMessage(error), /^招待を作れませんでした。/);
  });

  it('断られた理由ごとに、案内が違う', () => {
    assert.match(issueInviteErrorMessage(rejected(409, 'group_full')), /満員/);
    assert.match(issueInviteErrorMessage(rejected(409, 'too_many_invites')), /取り消して/);
    assert.match(issueInviteErrorMessage(rejected(403, 'forbidden')), /脱退が確定/);
    assert.match(issueInviteErrorMessage(rejected(409, 'conflict')), /重なりました/);
    // 知らない理由は、やり直しても直らないので、アプリの更新を案内する
    assert.match(issueInviteErrorMessage(rejected(409, 'something_new')), /更新/);
  });

  it('通信の失敗・混雑は、やり直しを案内する', () => {
    assert.match(issueInviteErrorMessage(new AuthError('network')), /通信できませんでした/);
    assert.match(issueInviteErrorMessage(new AuthError('unavailable')), /混み合って/);
  });

  it('セッションの失敗は、招待を作れなかったとは言わず、ログインを案内する', () => {
    assert.match(issueInviteErrorMessage(new AuthError('unauthorized')), /^ログインを確認できませんでした/);
    assert.match(issueInviteErrorMessage(new AuthError('not-signed-in')), /^ログインを確認できませんでした/);
    assert.match(issueInviteErrorMessage(new AuthError('storage-failed')), /ログイン情報を読み取れませんでした/);
  });
});

describe('revokeInviteErrorMessage', () => {
  it('どの文言も、「招待を取り消せませんでした」から始まる', () => {
    const errors = [
      new AuthError('network'),
      new AuthError('unavailable'),
      new AuthError('unexpected'),
      rejected(409, 'invite_already_used'),
      rejected(404, 'not_found'),
      rejected(409, 'conflict'),
      rejected(409, 'something_new'),
    ];
    for (const error of errors) assert.match(revokeInviteErrorMessage(error), /^招待を取り消せませんでした。/);
  });

  it('使われた招待・もう無い招待は、理由を伝える', () => {
    assert.match(revokeInviteErrorMessage(rejected(409, 'invite_already_used')), /すでに使われて/);
    // 404 は、メンバーでない・グループが無い・自分の招待でない、のとき。取り消し済み・期限切れは、サーバーが成功にする
    const notFound = revokeInviteErrorMessage(rejected(404, 'not_found'));
    assert.match(notFound, /グループの状態が変わった/);
    assert.doesNotMatch(notFound, /取り消された|期限/);
  });
});

describe('shouldReloadAfter', () => {
  it('発行: 満員・脱退の確定・グループが見つからない・未使用の招待が上限のときは、読み直す', () => {
    assert.equal(shouldReloadAfter(rejected(409, 'group_full'), 'issue'), true);
    assert.equal(shouldReloadAfter(rejected(403, 'forbidden'), 'issue'), true);
    assert.equal(shouldReloadAfter(rejected(404, 'not_found'), 'issue'), true);
    // 別の端末で発行した招待は、読み直すまで一覧に出ない。取り消すものが画面に出るようにする
    assert.equal(shouldReloadAfter(rejected(409, 'too_many_invites'), 'issue'), true);
  });

  it('発行: 競合・知らない理由・通信の失敗は、読み直さない（画面の状態は変わらない）', () => {
    assert.equal(shouldReloadAfter(rejected(409, 'conflict'), 'issue'), false);
    assert.equal(shouldReloadAfter(rejected(409, null), 'issue'), false);
    assert.equal(shouldReloadAfter(new AuthError('network'), 'issue'), false);
  });

  it('取り消し: 使われた・もう無いなど、一覧が古いときは読み直す。競合と通信の失敗は読み直さない', () => {
    assert.equal(shouldReloadAfter(rejected(409, 'invite_already_used'), 'revoke'), true);
    assert.equal(shouldReloadAfter(rejected(404, 'not_found'), 'revoke'), true);
    assert.equal(shouldReloadAfter(rejected(409, 'conflict'), 'revoke'), false);
    assert.equal(shouldReloadAfter(new AuthError('network'), 'revoke'), false);
  });
});

describe('resultUnknown', () => {
  it('サーバーが断った失敗は、済んでいない。それ以外（通信の失敗・応答が読めない・混雑）は、分からない', () => {
    assert.equal(resultUnknown(rejected(409, 'group_full')), false);
    assert.equal(resultUnknown(new AuthError('network')), true);
    assert.equal(resultUnknown(new AuthError('invalid-response')), true);
    assert.equal(resultUnknown(new AuthError('unavailable')), true);
  });
});
