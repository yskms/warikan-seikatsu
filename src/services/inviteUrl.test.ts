// 招待URLと共有の文面のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INVITE_URL_ORIGIN, inviteShareMessage, inviteUrl, isInviteOriginPlaceholder } from './inviteUrl.ts';

const TOKEN = 'abcDEF_-0123456789abcDEF_-0123456789abcdefg';

describe('inviteUrl', () => {
  it('道は /invite/<token>。HTTPS', () => {
    const url = inviteUrl(TOKEN, 'https://example.com');
    assert.equal(url, `https://example.com/invite/${TOKEN}`);
    assert.equal(new URL(url).protocol, 'https:');
    assert.equal(new URL(url).pathname.split('/').pop(), TOKEN);
  });

  it('置き場の末尾のスラッシュは重ねない', () => {
    assert.equal(inviteUrl('t', 'https://example.com/'), 'https://example.com/invite/t');
  });

  it('URLに使えない文字は符号化する', () => {
    assert.equal(inviteUrl('a/b?c#d', 'https://example.com'), 'https://example.com/invite/a%2Fb%3Fc%23d');
  });

  it('既定の置き場を使う', () => {
    assert.equal(inviteUrl('t'), `${INVITE_URL_ORIGIN}/invite/t`);
  });
});

describe('isInviteOriginPlaceholder', () => {
  it('既定の置き場は、本番のドメイン（仮の値ではない）。`.invalid` は仮の値', () => {
    assert.equal(isInviteOriginPlaceholder(), false);
    assert.equal(INVITE_URL_ORIGIN, 'https://warikan-seikatsu.app');
    assert.equal(isInviteOriginPlaceholder('https://not-created-yet.invalid'), true);
    assert.equal(isInviteOriginPlaceholder('https://example.com'), false);
  });
});

describe('inviteShareMessage', () => {
  it('URLは、文面の最後の行に置く（メッセージアプリがリンクとして認識する）', () => {
    const url = inviteUrl(TOKEN, 'https://example.com');
    const lines = inviteShareMessage(url).split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], url);
    assert.match(lines[0]!, /3日間有効/);
  });
});
