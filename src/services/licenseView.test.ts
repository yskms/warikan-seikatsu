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
  {
    kind: 'native', name: 'Google Play services', version: '21.0.0', license: 'Android Software Development Kit License',
    licenseUrl: 'https://developer.android.com/studio/terms', platform: 'android',
    includes: ['com.google.android.gms:play-services-auth:21.0.0'],
  },
];

describe('buildLicenseItems', () => {
  it('その OS に入るものだけを、元の並びのまま返す', () => {
    const ios = buildLicenseItems(packages, texts, 'ios');
    assert.deepEqual(ios.openSource.map((item) => item.name), ['react', 'SocketRocket']);
    assert.deepEqual(ios.terms, []);
    const android = buildLicenseItems(packages, texts, 'android');
    assert.deepEqual(android.openSource.map((item) => item.name), ['react', 'AndroidX']);
    assert.deepEqual(android.terms.map((item) => item.name), ['Google Play services']);
  });

  it('版があれば「版 · 種類」、無ければ種類だけ。全文と中身を引く', () => {
    const items = buildLicenseItems(packages, texts, 'android').openSource;
    assert.deepEqual(items[0], { key: 'react@19.2.3', name: 'react', detail: '19.2.3 · MIT', text: 'MIT text' });
    assert.deepEqual(items[1], {
      key: 'AndroidX@',
      name: 'AndroidX',
      detail: 'Apache-2.0',
      text: 'Apache text',
      includes: ['androidx.core:core:1.0.0'],
    });
  });

  it('全文を載せないもの（規約のURLだけ）は、全文を持たず、別に返す', () => {
    const [item] = buildLicenseItems(packages, texts, 'android').terms;
    assert.deepEqual(item, {
      key: 'Google Play services@21.0.0',
      name: 'Google Play services',
      detail: '21.0.0 · Android Software Development Kit License',
      termsUrl: 'https://developer.android.com/studio/terms',
      includes: ['com.google.android.gms:play-services-auth:21.0.0'],
    });
    assert.ok(!('text' in item));
  });

  it('全文が引けないものは、空にせず、投げる', () => {
    assert.throws(() => buildLicenseItems([{ kind: 'npm', name: 'x', license: 'MIT', text: 5 }], texts, 'ios'), /x/);
  });

  it('全文も規約のURLも持たない・両方持つものは、黙って流さず、投げる', () => {
    assert.throws(() => buildLicenseItems([{ kind: 'npm', name: 'y', license: 'MIT' }], texts, 'ios'), /y/);
    assert.throws(
      () => buildLicenseItems([{ kind: 'npm', name: 'z', license: 'MIT', text: 0, licenseUrl: 'https://example.com' }], texts, 'ios'),
      /z/,
    );
  });

  it('生成物は、どちらの OS でも組み立てられ、キーが重ならない', () => {
    for (const os of ['ios', 'android'] as const) {
      const { openSource, terms } = buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, os);
      assert.ok(openSource.length > 50, os);
      const keys = [...openSource, ...terms].map((item) => item.key);
      assert.equal(new Set(keys).size, keys.length, os);
      assert.ok(openSource.every((item) => item.text.length > 0), os);
      assert.ok(terms.every((item) => item.termsUrl.startsWith('https://')), os);
    }
  });

  it('規約のURLだけの別枠は、Androidだけに出る（Google Play services・googleid）', () => {
    const terms = (os: 'ios' | 'android') =>
      buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, os).terms.map((item) => item.name);
    assert.deepEqual(terms('ios'), []);
    assert.deepEqual(terms('android'), ['Google Identity (googleid)', 'Google Play services']);
  });

  it('片方の OS にだけ入るものは、もう片方に出ない', () => {
    const names = (os: 'ios' | 'android') =>
      new Set(buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, os).openSource.map((item) => item.name));
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
