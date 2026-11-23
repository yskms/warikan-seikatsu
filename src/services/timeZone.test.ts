// 端末のタイムゾーンの取得のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getDeviceTimeZone } from './timeZone.ts';

function fakeIntl(timeZone: unknown): Pick<typeof Intl, 'DateTimeFormat'> {
  return {
    DateTimeFormat: (() => ({ resolvedOptions: () => ({ timeZone }) })) as unknown as typeof Intl.DateTimeFormat,
  };
}

describe('getDeviceTimeZone', () => {
  it('IANAの名前を返す', () => {
    assert.equal(getDeviceTimeZone(fakeIntl('Asia/Tokyo')), 'Asia/Tokyo');
    assert.equal(getDeviceTimeZone(fakeIntl('America/Argentina/Buenos_Aires')), 'America/Argentina/Buenos_Aires');
    assert.equal(getDeviceTimeZone(fakeIntl('UTC')), 'UTC');
  });

  it('取れない・形が違うときは null（既定値にしない）', () => {
    for (const value of [undefined, null, '', 1, '+09:00', 'Asia Tokyo', 'a'.repeat(65)]) {
      assert.equal(getDeviceTimeZone(fakeIntl(value)), null, String(value));
    }
  });

  it('Intl が例外を投げても null', () => {
    const broken = {
      DateTimeFormat: (() => {
        throw new Error('no intl');
      }) as unknown as typeof Intl.DateTimeFormat,
    };
    assert.equal(getDeviceTimeZone(broken), null);
  });

  it('この環境の Intl で、文字列が返る', () => {
    const name = getDeviceTimeZone();
    assert.ok(name === null || typeof name === 'string');
  });
});
