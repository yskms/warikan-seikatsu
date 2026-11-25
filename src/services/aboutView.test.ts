// 「このアプリについて」の表示内容のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAboutLinks, buildLegalLinks, versionLabel } from './aboutView.ts';

const PUBLISHED = {
  privacyPolicy: 'https://example.com/privacy-policy',
  termsOfService: 'https://example.com/terms',
  contact: 'https://example.com/contact',
};

describe('buildAboutLinks', () => {
  it('公開済みのページは、プライバシーポリシー・利用規約・お問い合わせの順で出す', () => {
    assert.deepEqual(
      buildAboutLinks(PUBLISHED).map((link) => [link.key, link.label, link.url]),
      [
        ['privacyPolicy', 'プライバシーポリシー', 'https://example.com/privacy-policy'],
        ['termsOfService', '利用規約', 'https://example.com/terms'],
        ['contact', 'お問い合わせ', 'https://example.com/contact'],
      ],
    );
  });

  it('仮の値のページは出さない（ほかのページは出る）', () => {
    const links = buildAboutLinks({ ...PUBLISHED, termsOfService: 'https://not-created-yet.invalid/terms' });
    assert.deepEqual(
      links.map((link) => link.key),
      ['privacyPolicy', 'contact'],
    );
  });
});

describe('buildLegalLinks（ログイン画面の法務リンク）', () => {
  it('プライバシーポリシーと利用規約だけを、同じ表示名で出す（お問い合わせは出さない）', () => {
    assert.deepEqual(
      buildLegalLinks(PUBLISHED).map((link) => [link.key, link.label]),
      [
        ['privacyPolicy', 'プライバシーポリシー'],
        ['termsOfService', '利用規約'],
      ],
    );
  });

  it('仮の値のページは出さない', () => {
    const links = buildLegalLinks({ ...PUBLISHED, privacyPolicy: 'https://not-created-yet.invalid/privacy-policy' });
    assert.deepEqual(
      links.map((link) => link.key),
      ['termsOfService'],
    );
  });
});

describe('versionLabel', () => {
  it('版を、そのまま出す', () => {
    assert.equal(versionLabel('1.2.3'), '1.2.3');
  });

  it('前後の空白は除く', () => {
    assert.equal(versionLabel(' 1.2.3 '), '1.2.3');
  });

  it('読めなかったとき（null・undefined・空）は「不明」', () => {
    assert.equal(versionLabel(null), '不明');
    assert.equal(versionLabel(undefined), '不明');
    assert.equal(versionLabel('  '), '不明');
  });
});
