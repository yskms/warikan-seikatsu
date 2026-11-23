// セッションが無くなったことの通知のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError, type AuthErrorCode } from '../repositories/authError.ts';
import type { AccountService, DeleteAccountResult, SessionAccess } from './accountService.ts';
import { withSessionLostNotice } from './sessionLost.ts';

function setup(overrides: {
  signOut?: AccountService['signOut'];
  deleteAccount?: AccountService['deleteAccount'];
  withSession?: SessionAccess['withSession'];
} = {}) {
  const account: AccountService = {
    getSignedInProvider: async () => 'apple',
    signIn: async () => {},
    signOut: overrides.signOut ?? (async () => ({ serverRevoked: true })),
    deleteAccount:
      overrides.deleteAccount ?? (async () => ({ sessionCleared: true, appleRevoked: null }) satisfies DeleteAccountResult),
  };
  const access: SessionAccess = {
    withSession: overrides.withSession ?? (async (task) => task('S')),
  };
  const notifier = withSessionLostNotice(account, access);
  let notices = 0;
  notifier.subscribe(() => void (notices += 1));
  return { notifier, notices: () => notices };
}

const fail = (code: AuthErrorCode) => async (): Promise<never> => {
  throw new AuthError(code);
};

describe('signOut', () => {
  it('成功したら通知する（結果はそのまま）', async () => {
    const { notifier, notices } = setup();
    assert.deepEqual(await notifier.account.signOut(), { serverRevoked: true });
    assert.equal(notices(), 1);
  });

  it('端末の値を消せなかった（storage-failed）ときは、通知しない', async () => {
    const { notifier, notices } = setup({ signOut: fail('storage-failed') });
    await assert.rejects(notifier.account.signOut(), { code: 'storage-failed' });
    assert.equal(notices(), 0);
  });
});

describe('deleteAccount', () => {
  it('成功し、端末のセッションも捨てられたら通知する', async () => {
    const { notifier, notices } = setup();
    await notifier.account.deleteAccount();
    assert.equal(notices(), 1);
  });

  it('成功したが、端末のセッションを捨てられなかったときは、通知しない（画面が案内を出す）', async () => {
    const { notifier, notices } = setup({
      deleteAccount: async () => ({ sessionCleared: false, appleRevoked: null }),
    });
    assert.equal((await notifier.account.deleteAccount()).sessionCleared, false);
    assert.equal(notices(), 0);
  });

  for (const code of ['unauthorized', 'not-signed-in'] as const) {
    it(`${code} は通知して、そのまま投げ直す`, async () => {
      const { notifier, notices } = setup({ deleteAccount: fail(code) });
      await assert.rejects(notifier.account.deleteAccount(), { code });
      assert.equal(notices(), 1);
    });
  }

  for (const code of ['network', 'reauth-failed', 'account-mismatch', 'delete-unconfirmed', 'storage-failed'] as const) {
    it(`${code} は通知しない（セッションは生きている、または分からない）`, async () => {
      const { notifier, notices } = setup({ deleteAccount: fail(code) });
      await assert.rejects(notifier.account.deleteAccount(), { code });
      assert.equal(notices(), 0);
    });
  }
});

describe('withSession', () => {
  it('成功した結果は、そのまま返す。通知しない', async () => {
    const { notifier, notices } = setup();
    assert.equal(await notifier.access.withSession(async (session) => `got ${session}`), 'got S');
    assert.equal(notices(), 0);
  });

  for (const code of ['unauthorized', 'not-signed-in'] as const) {
    it(`${code} は通知して、そのまま投げ直す`, async () => {
      const { notifier, notices } = setup({ withSession: fail(code) });
      await assert.rejects(notifier.access.withSession(async () => 1), { code });
      assert.equal(notices(), 1);
    });
  }

  for (const code of ['network', 'unavailable', 'storage-failed'] as const) {
    it(`${code} は通知しない`, async () => {
      const { notifier, notices } = setup({ withSession: fail(code) });
      await assert.rejects(notifier.access.withSession(async () => 1), { code });
      assert.equal(notices(), 0);
    });
  }

  it('AuthError でない失敗は、通知せず、そのまま投げ直す', async () => {
    const boom = new Error('boom');
    const { notifier, notices } = setup({
      withSession: async () => {
        throw boom;
      },
    });
    await assert.rejects(notifier.access.withSession(async () => 1), boom);
    assert.equal(notices(), 0);
  });
});

describe('subscribe', () => {
  it('解除したあとは通知しない。受け取る側の失敗は、呼び出し元の結果を変えない', async () => {
    const { notifier } = setup();
    let calls = 0;
    const off = notifier.subscribe(() => void (calls += 1));
    notifier.subscribe(() => {
      throw new Error('listener failed');
    });
    assert.deepEqual(await notifier.account.signOut(), { serverRevoked: true });
    assert.equal(calls, 1);
    off();
    await notifier.account.signOut();
    assert.equal(calls, 1);
  });
});
