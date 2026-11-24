// メンバー・費目の色のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MEMBER_COLORS } from '../domain/group.ts';
import { palette, paletteColor, paletteText } from './palette.ts';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe('palette', () => {
  it('メンバーの色のキーが、すべて揃っている（Workerの一覧と同じ並び。group.test.ts）', () => {
    assert.deepEqual(Object.keys(palette), [...MEMBER_COLORS]);
  });

  it('全部が #RRGGBB', () => {
    for (const color of [...Object.values(palette), paletteText]) assert.match(color, /^#[0-9A-F]{6}$/);
  });

  for (const [key, color] of Object.entries(palette)) {
    it(`${key}: 塗りの上の文字がAA（4.5:1）を満たす`, () => {
      assert.ok(contrast(paletteText, color) >= 4.5, `${paletteText} on ${color}`);
    });
  }

  it('知らないキーは gray', () => {
    assert.equal(paletteColor('pink'), palette.pink);
    assert.equal(paletteColor('unknown'), palette.gray);
    assert.equal(paletteColor(''), palette.gray);
    // 継承されたプロパティ名で、色以外の値を返さない
    assert.equal(paletteColor('toString'), palette.gray);
    assert.equal(paletteColor('constructor'), palette.gray);
  });
});
