// `V`・`C`・`SHA-256(T)` の生成のテスト。`npm test` で実行する。乱数とSHA-256は、Nodeの `node:crypto` で動かす
// （実機の expo-crypto での確認の代わりにはならない）。Workerが期待する形（43字のbase64url。`worker/src/nonce.ts`）を固定する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { createAuthCrypto, VERIFIER_BYTES, type CryptoPrimitives } from './authCrypto.ts';

const nodePrimitives: CryptoPrimitives = {
  getRandomBytes: (length) => new Uint8Array(randomBytes(length)),
  sha256Base64: async (text) => createHash('sha256').update(text, 'utf8').digest('base64'),
};

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

async function rejectsUnexpected(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof AuthError && error.code === 'unexpected');
}

describe('randomVerifier（V）', () => {
  it('32バイトの乱数を要求し、43字の base64url にする（Workerの isChallenge と同じ形）', () => {
    const requested: number[] = [];
    const crypto = createAuthCrypto({
      ...nodePrimitives,
      getRandomBytes: (length) => {
        requested.push(length);
        return nodePrimitives.getRandomBytes(length);
      },
    });
    const verifier = crypto.randomVerifier();
    assert.deepEqual(requested, [VERIFIER_BYTES]);
    assert.equal(VERIFIER_BYTES, 32);
    assert.match(verifier, BASE64URL_43);
  });

  it('呼ぶたびに別の値になる', () => {
    const crypto = createAuthCrypto(nodePrimitives);
    const values = new Set(Array.from({ length: 50 }, () => crypto.randomVerifier()));
    assert.equal(values.size, 50);
  });

  it('乱数の取得に失敗した・長さが違うときは unexpected', () => {
    const failing = createAuthCrypto({
      ...nodePrimitives,
      getRandomBytes: () => {
        throw new Error('no entropy');
      },
    });
    assert.throws(() => failing.randomVerifier(), (error) => error instanceof AuthError && error.code === 'unexpected');
    for (const length of [0, 16, 31, 33]) {
      const wrong = createAuthCrypto({ ...nodePrimitives, getRandomBytes: () => new Uint8Array(length).fill(7) });
      assert.throws(() => wrong.randomVerifier(), (error) => error instanceof AuthError && error.code === 'unexpected');
    }
  });
});

describe('sha256Base64Url（SHA-256(T)・C）', () => {
  it('SHA-256("abc") の既知の値と、43字の base64url になる', async () => {
    const crypto = createAuthCrypto(nodePrimitives);
    assert.equal(await crypto.sha256Base64Url('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('C = SHA-256(V) は、V の文字列（UTF-8）のハッシュで、V を base64url からデコードしたバイト列のハッシュではない', async () => {
    const crypto = createAuthCrypto(nodePrimitives);
    const verifier = crypto.randomVerifier();
    const challenge = await crypto.sha256Base64Url(verifier);
    assert.match(challenge, BASE64URL_43);
    assert.equal(challenge, createHash('sha256').update(verifier, 'utf8').digest('base64url'));
    assert.notEqual(challenge, createHash('sha256').update(Buffer.from(verifier, 'base64url')).digest('base64url'));
  });

  it('T のような、ドットを含む文字列も、そのままのハッシュにする', async () => {
    const nonce = 'v1.native.1700000000000.AAAAAAAAAAAAAAAAAAAAAA..SIGNATURE';
    const crypto = createAuthCrypto(nodePrimitives);
    assert.equal(await crypto.sha256Base64Url(nonce), createHash('sha256').update(nonce).digest('base64url'));
  });

  it('計算に失敗した・想定の形でないダイジェストは unexpected', async () => {
    const failing = createAuthCrypto({
      ...nodePrimitives,
      sha256Base64: async () => {
        throw new Error('digest failed');
      },
    });
    await rejectsUnexpected(failing.sha256Base64Url('abc'));
    for (const digest of ['', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`]) {
      const crypto = createAuthCrypto({ ...nodePrimitives, sha256Base64: async () => digest });
      await rejectsUnexpected(crypto.sha256Base64Url('x'));
    }
  });

  it('実行環境が返す base64（パディングあり・+ と /）を base64url に直す', async () => {
    const crypto = createAuthCrypto({
      ...nodePrimitives,
      sha256Base64: async () => 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
    });
    assert.equal(await crypto.sha256Base64Url('x'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('エラーの message に、入力（T・V）を載せない', async () => {
    const secret = 'SECRET-T-VALUE';
    const crypto = createAuthCrypto({
      ...nodePrimitives,
      sha256Base64: async (text) => {
        throw new Error(`failed for ${text}`);
      },
    });
    await assert.rejects(crypto.sha256Base64Url(secret), (error) => {
      assert.ok(error instanceof AuthError);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  });
});
