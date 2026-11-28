// 招待URLの解析のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findInviteToken, INVITE_SCHEME_PREFIX, parseInviteLink } from './inviteLink.ts';
import { inviteShareMessage, inviteUrl } from './inviteUrl.ts';

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

describe('findInviteToken（貼り付けた文字の中から、招待URLを探す）', () => {
  const URL = `${ORIGIN}/invite/${TOKEN}`;

  it('招待URLだけでも、アプリのURLスキームでも、読める', () => {
    assert.equal(findInviteToken(URL, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`${INVITE_SCHEME_PREFIX}${TOKEN}`, ORIGIN), TOKEN);
  });

  it('招待の文面ごと貼られても読める（前後の文・改行・前置き）', () => {
    assert.equal(findInviteToken(`わりかん生活に招待されました。\n${URL}\n3日で無効になります。`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`URL:${URL}`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`招待URL→${URL}から参加してください`, ORIGIN), TOKEN);
  });

  it('全角の句読点・括弧、文末のピリオド・閉じ括弧が、URLの直後にあっても読める', () => {
    assert.equal(findInviteToken(`${URL}。`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`（${URL}）`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`「${URL}」`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`see ${URL}.`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`(${URL})`, ORIGIN), TOKEN);
    assert.equal(findInviteToken(`${URL}?utm_source=line,`, ORIGIN), TOKEN);
  });

  it('前後の空白や、複数のURLがあっても、先に見つかった招待URLを返す', () => {
    assert.equal(findInviteToken(`  \n${URL}\t `, ORIGIN), TOKEN);
    const other = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponml_-'; // 43字
    assert.equal(findInviteToken(`https://example.com/a ${ORIGIN}/invite/${other} ${URL}`, ORIGIN), other);
  });

  it('招待でないURLが先にあっても、あとの招待URLを読める', () => {
    assert.equal(findInviteToken(`https://evil.example.org/invite/${TOKEN} ${URL}`, ORIGIN), TOKEN);
  });

  it('ほかのホーム・ほかの道・トークンの形が違うものは、読まない（parseInviteLink と同じ）', () => {
    assert.equal(findInviteToken(`https://evil.example.org/invite/${TOKEN}`, ORIGIN), null);
    assert.equal(findInviteToken(`${ORIGIN}/join/${TOKEN}`, ORIGIN), null);
    assert.equal(findInviteToken(`${ORIGIN}/invite/${TOKEN.slice(1)}`, ORIGIN), null);
    assert.equal(findInviteToken(`${ORIGIN}/invite/${TOKEN}x`, ORIGIN), null);
    assert.equal(findInviteToken(`${ORIGIN}/invite/${TOKEN}/extra`, ORIGIN), null);
    assert.equal(findInviteToken(`${TOKEN}`, ORIGIN), null);
  });

  it('招待URLを含まない文字・空・長すぎる値は、null', () => {
    assert.equal(findInviteToken('こんにちは', ORIGIN), null);
    assert.equal(findInviteToken('', ORIGIN), null);
    assert.equal(findInviteToken(`${URL}${' '.repeat(10_001)}`, ORIGIN), null);
    assert.equal(findInviteToken(undefined as unknown as string, ORIGIN), null);
  });

  it('別のURLのクエリに入っていても、招待URLとして読む（意図して許す。読むだけで、参加の確認が内容を見せるので、害はない）', () => {
    assert.equal(findInviteToken(`https://example.com/?r=${URL}`, ORIGIN), TOKEN);
  });

  it('URLの直後に半角英数がつながると読めない（1行の欄で、改行が取り除かれた場合。案内で、URLだけの貼り付けを勧める）', () => {
    assert.equal(findInviteToken(`${URL}Thanks`, ORIGIN), null);
    // 半角の数字も、トークンに使える文字なので、つながると読めない（「…\n3日で無効」の改行が取り除かれた場合）
    assert.equal(findInviteToken(`${URL}3日で無効になります。`, ORIGIN), null);
    // 日本語は、トークンに使えない文字なので、つながっていても読める
    assert.equal(findInviteToken(`${URL}は3日で無効になります。`, ORIGIN), TOKEN);
    // アプリの共有文面（URLが末尾。直前は全角の「）」）は、改行が取り除かれても読める
    assert.equal(findInviteToken(inviteShareMessage(inviteUrl(TOKEN, ORIGIN)).replace('\n', ''), ORIGIN), TOKEN);
  });

  it('既定の置き場でも、発行側のURL（inviteUrl）をそのまま読める', () => {
    assert.equal(findInviteToken(`招待です: ${inviteUrl(TOKEN)}`), TOKEN);
  });
});
