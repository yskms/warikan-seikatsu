/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ThirdPartyPackage } from '../legal/thirdPartyLicenses.ts';
import { THIRD_PARTY_LICENSE_TEXTS, THIRD_PARTY_PACKAGES } from '../legal/thirdPartyLicenses.ts';
import { buildLicenseItems, licenseOsOf } from './licenseView.ts';

const texts = ['MIT text', 'Apache text'];
const packages: ThirdPartyPackage[] = [
  { kind: 'npm', name: 'react', version: '19.2.3', license: 'MIT', text: 0 },
  { kind: 'native', name: 'SocketRocket', version: '0.7.1', license: 'MIT', text: 0, platform: 'ios' },
  {
    kind: 'native', name: 'AndroidX', license: 'Apache-2.0', text: 1, platform: 'android',
    includes: ['androidx.core:core:1.0.0'],
  },
];

describe('buildLicenseItems', () => {
  it('その OS に入るものだけを、元の並びのまま返す', () => {
    assert.deepEqual(buildLicenseItems(packages, texts, 'ios').map((item) => item.name), ['react', 'SocketRocket']);
    assert.deepEqual(buildLicenseItems(packages, texts, 'android').map((item) => item.name), ['react', 'AndroidX']);
  });

  it('版があれば「版 · 種類」、無ければ種類だけ。全文と中身を引く', () => {
    const items = buildLicenseItems(packages, texts, 'android');
    assert.deepEqual(items[0], { key: 'react@19.2.3', name: 'react', detail: '19.2.3 · MIT', text: 'MIT text' });
    assert.deepEqual(items[1], {
      key: 'AndroidX@',
      name: 'AndroidX',
      detail: 'Apache-2.0',
      text: 'Apache text',
      includes: ['androidx.core:core:1.0.0'],
    });
  });

  it('全文が引けないものは、空にせず、投げる', () => {
    assert.throws(() => buildLicenseItems([{ kind: 'npm', name: 'x', license: 'MIT', text: 5 }], texts, 'ios'), /x/);
  });

  it('生成物は、どちらの OS でも組み立てられ、キーが重ならない', () => {
    for (const os of ['ios', 'android'] as const) {
      const items = buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, os);
      assert.ok(items.length > 50, os);
      assert.equal(new Set(items.map((item) => item.key)).size, items.length, os);
      assert.ok(items.every((item) => item.text.length > 0), os);
    }
  });

  it('片方の OS にだけ入るものは、もう片方に出ない', () => {
    const names = (os: 'ios' | 'android') =>
      new Set(buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, os).map((item) => item.name));
    assert.ok(names('ios').has('SocketRocket') && !names('android').has('SocketRocket'));
    assert.ok(names('android').has('AndroidX') && !names('ios').has('AndroidX'));
    assert.ok(names('ios').has('react-native') && names('android').has('react-native'));
  });
});

describe('licenseOsOf', () => {
  it('iOS は ios、それ以外は android', () => {
    assert.equal(licenseOsOf('ios'), 'ios');
    assert.equal(licenseOsOf('android'), 'android');
    assert.equal(licenseOsOf('web'), 'android');
  });
});
