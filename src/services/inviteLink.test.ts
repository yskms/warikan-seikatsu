// 招待URLの解析のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INVITE_SCHEME_PREFIX, parseInviteLink } from './inviteLink.ts';
import { inviteUrl } from './inviteUrl.ts';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-'; // 43字
const ORIGIN = 'https://invite.example.com';

describe('parseInviteLink', () => {
  it('置き場のURL（共有するURL）から、トークンを取り出す', () => {
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}`, ORIGIN), TOKEN);
  });

  it('アプリのURLスキームからも、トークンを取り出す', () => {
    assert.equal(parseInviteLink(`${INVITE_SCHEME_PREFIX}${TOKEN}`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`warikan-seikatsu://invite/${TOKEN}`, ORIGIN), TOKEN);
  });

  it('発行側のURL（inviteUrl）を、そのまま読める', () => {
    assert.equal(parseInviteLink(inviteUrl(TOKEN, ORIGIN), ORIGIN), TOKEN);
    // 既定の置き場（仮の値）どうしも一致する
    assert.equal(parseInviteLink(inviteUrl(TOKEN)), TOKEN);
  });

  it('クエリ・フラグメント・末尾のスラッシュは無視する', () => {
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}?utm_source=line`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}#top`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}/`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`${INVITE_SCHEME_PREFIX}${TOKEN}/?a=b`, ORIGIN), TOKEN);
  });

  it('スキームとホストの大文字小文字は区別しない。トークンは区別する', () => {
    assert.equal(parseInviteLink(`HTTPS://INVITE.EXAMPLE.COM/invite/${TOKEN}`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`WARIKAN-SEIKATSU://invite/${TOKEN}`, ORIGIN), TOKEN);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN.toLowerCase()}`, ORIGIN), TOKEN.toLowerCase());
  });

  it('置き場の末尾にスラッシュがあっても読める', () => {
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}`, `${ORIGIN}/`), TOKEN);
  });

  it('ほかのホーム・ほかのスキーム・ほかの道は、招待URLとして扱わない', () => {
    assert.equal(parseInviteLink(`https://evil.example.org/invite/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`https://invite.example.com.evil.org/invite/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`http://invite.example.com/invite/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`other-app://invite/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/join/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/other/invite/${TOKEN}`, ORIGIN), null);
    assert.equal(parseInviteLink(`warikan-seikatsu://auth/apple?code=x&state=y`, ORIGIN), null);
  });

  it('トークンの形が違うものは、取り出さない', () => {
    assert.equal(parseInviteLink(`${ORIGIN}/invite/`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN.slice(1)}`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}x`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN.slice(0, 42)}!`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN.slice(0, 40)}%2F..`, ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}/extra`, ORIGIN), null);
  });

  it('空・長すぎる値は、読まずに捨てる', () => {
    assert.equal(parseInviteLink('', ORIGIN), null);
    assert.equal(parseInviteLink(`${ORIGIN}/invite/${TOKEN}?${'a'.repeat(3000)}`, ORIGIN), null);
    assert.equal(parseInviteLink(undefined as unknown as string, ORIGIN), null);
  });
});
