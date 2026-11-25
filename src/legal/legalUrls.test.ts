// 法務のURLのテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CONTACT_URL, isPlaceholderUrl, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from './legalUrls.ts';

describe('legalUrls', () => {
  it('すべてHTTPSのURL', () => {
    for (const url of [PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, CONTACT_URL]) {
      assert.equal(new URL(url).protocol, 'https:');
    }
  });

  it('仮の値かを、ホスト名で見分ける', () => {
    assert.equal(isPlaceholderUrl('https://not-created-yet.invalid/privacy-policy'), true);
    assert.equal(isPlaceholderUrl('https://example.com/privacy-policy'), false);
    assert.equal(isPlaceholderUrl('https://invalid.example.com/'), false);
  });
});
