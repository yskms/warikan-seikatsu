// 参加確認の失敗の分類と文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import { InviteRejectedError } from '../repositories/inviteRepository.ts';
import { classifyJoinFailure, classifyPreviewFailure, GROUP_FULL_MESSAGE, INVITE_UNAVAILABLE_MESSAGE } from './joinMessage.ts';

const NETWORK_CODES: AuthErrorCode[] = [
  'network',
  'unavailable',
  'unauthorized',
  'not-signed-in',
  'storage-failed',
  'invalid-response',
  'invalid-request',
  'unexpected',
];

describe('classifyPreviewFailure（招待内容の確認の失敗）', () => {
  it('404 は、理由によらず「使えない招待」（やり直しても同じ）', () => {
    for (const reason of ['invite_unavailable', 'not_found', null]) {
      assert.deepEqual(classifyPreviewFailure(new InviteRejectedError(404, reason)), { kind: 'unavailable' });
    }
  });

  it('それ以外は、やり直せる失敗として、文言を返す', () => {
    for (const code of NETWORK_CODES) {
      const failure = classifyPreviewFailure(new AuthError(code));
      assert.equal(failure.kind, 'retry', code);
      assert.ok(failure.kind === 'retry' && failure.message.length > 0, code);
    }
    const rejected = classifyPreviewFailure(new InviteRejectedError(409, 'conflict'));
    assert.equal(rejected.kind, 'retry');
    assert.equal(classifyPreviewFailure(new Error('x')).kind, 'retry');
  });

  it('通信の失敗は電波、混雑は時間をおく、形が違う応答は通信環境と更新を案内する', () => {
    const message = (code: AuthErrorCode) => {
      const failure = classifyPreviewFailure(new AuthError(code));
      return failure.kind === 'retry' ? failure.message : '';
    };
    assert.match(message('network'), /電波/);
    assert.match(message('unavailable'), /しばらく/);
    assert.match(message('invalid-response'), /Wi-Fi/);
    assert.match(message('invalid-request'), /更新/);
    assert.match(message('storage-failed'), /ロック/);
  });

  it('文言に、トークンやURLを載せない', () => {
    for (const code of NETWORK_CODES) {
      const failure = classifyPreviewFailure(new AuthError(code, 'HTTP 500 https://x.invalid/invites/SECRET'));
      assert.ok(failure.kind !== 'retry' || !failure.message.includes('SECRET'));
    }
  });
});

describe('classifyJoinFailure（参加の失敗）', () => {
  it('404 は「使えない招待」', () => {
    assert.deepEqual(classifyJoinFailure(new InviteRejectedError(404, 'invite_unavailable')), { kind: 'unavailable' });
  });

  it('409 group_full は満員', () => {
    assert.deepEqual(classifyJoinFailure(new InviteRejectedError(409, 'group_full')), { kind: 'full' });
  });

  it('409 already_member は、成功として扱う（グループのIDを渡す。読めなければ null）', () => {
    assert.deepEqual(classifyJoinFailure(new InviteRejectedError(409, 'already_member', 'g7')), {
      kind: 'already-member',
      groupId: 'g7',
    });
    assert.deepEqual(classifyJoinFailure(new InviteRejectedError(409, 'already_member')), {
      kind: 'already-member',
      groupId: null,
    });
  });

  it('競合・ほかの断りは、もう一度押してもらう', () => {
    const conflict = classifyJoinFailure(new InviteRejectedError(409, 'conflict'));
    assert.equal(conflict.kind, 'failed');
    assert.ok(conflict.kind === 'failed' && conflict.message.includes('もう一度「参加する」'));
    const other = classifyJoinFailure(new InviteRejectedError(400, 'invalid_request'));
    assert.equal(other.kind, 'failed');
    // 食い違いは、やり直しても直らない。更新を案内する
    assert.ok(other.kind === 'failed' && other.message.includes('更新'));
  });

  it('結果が分からない失敗（通信・混雑・応答が読めない・不明）は、参加できている場合があると伝えて、もう一度押してもらう', () => {
    for (const code of ['network', 'unavailable', 'invalid-response', 'unexpected'] as const) {
      const failure = classifyJoinFailure(new AuthError(code));
      assert.equal(failure.kind, 'failed', code);
      assert.ok(failure.kind === 'failed' && failure.message.includes('参加できている場合があります'), code);
      assert.ok(failure.kind === 'failed' && failure.message.includes('もう一度「参加する」'), code);
    }
    assert.equal(classifyJoinFailure('文字列').kind, 'failed');
  });

  it('ログインの失敗は、ログインし直し・端末のロックを案内する（参加の再送は案内しない）', () => {
    for (const code of ['unauthorized', 'not-signed-in'] as const) {
      const failure = classifyJoinFailure(new AuthError(code));
      assert.ok(failure.kind === 'failed' && failure.message.includes('ログイン'), code);
    }
    const storage = classifyJoinFailure(new AuthError('storage-failed'));
    assert.ok(storage.kind === 'failed' && storage.message.includes('ロック'));
  });
});

describe('固定の文言', () => {
  it('使えない招待と満員の文言は、画面設計（docs/screens.md 2章）のとおり', () => {
    assert.equal(INVITE_UNAVAILABLE_MESSAGE, 'この招待URLは使えません。招待した人に、新しいURLを送ってもらってください。');
    assert.equal(GROUP_FULL_MESSAGE, 'このグループは満員です（5人まで）。');
  });
});
