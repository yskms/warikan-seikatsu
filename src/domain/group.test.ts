// グループの定数が、Worker（worker/src/）の表と食い違っていないかの確認。`npm test` で実行する。
// アプリとWorkerはコードを共有しないので、両側に書いた表が揃っていることを、ファイルを読んで確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MEMBER_COLORS,
} from './group.ts';

const workerFile = (name: string) => readFileSync(new URL(`../../worker/src/${name}`, import.meta.url), 'utf8');

describe('Workerとの表の一致', () => {
  it('選べる通貨と小数桁数が、worker/src/currencies.ts と同じ', () => {
    const source = workerFile('currencies.ts');
    const body = /CURRENCY_MINOR_UNITS[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1];
    assert.ok(body, 'Workerの通貨の表が読めない（書き方が変わったら、このテストを直す）');
    const worker = [...body.matchAll(/([A-Z]{3}):\s*(\d+)/g)].map(([, code, unit]) => [code, Number(unit)]);
    assert.ok(worker.length > 0);
    assert.deepEqual(
      CURRENCIES.map((currency) => [currency.code, currency.minorUnit]),
      worker,
    );
    assert.match(source, new RegExp(`DEFAULT_CURRENCY_CODE\\s*=\\s*'${DEFAULT_CURRENCY_CODE}'`));
    assert.equal(CURRENCIES[0]?.code, DEFAULT_CURRENCY_CODE);
  });

  it('メンバーの色が、worker/src/membership.ts と同じ並び', () => {
    const body = /MEMBER_COLORS\s*=\s*\[([^\]]*)\]/.exec(workerFile('membership.ts'))?.[1];
    assert.ok(body, 'Workerの色の一覧が読めない');
    const worker = [...body.matchAll(/'([a-z]+)'/g)].map(([, color]) => color);
    assert.deepEqual([...MEMBER_COLORS], worker);
  });

  it('グループ名・表示名の上限が、worker/src/limits.ts と同じ', () => {
    const source = workerFile('limits.ts');
    assert.match(source, new RegExp(`MAX_GROUP_NAME_LENGTH\\s*=\\s*${MAX_GROUP_NAME_LENGTH}\\b`));
    assert.match(source, new RegExp(`MAX_DISPLAY_NAME_LENGTH\\s*=\\s*${MAX_DISPLAY_NAME_LENGTH}\\b`));
  });
});
