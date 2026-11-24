// いま開くグループの決め方のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickGroup } from './groupChoice.ts';

const groups = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];

describe('pickGroup', () => {
  it('候補が無ければ、先頭（作成の古い順）を開く', () => {
    assert.equal(pickGroup(groups, [])?.id, 'g1');
    assert.equal(pickGroup(groups, [null, null])?.id, 'g1');
  });

  it('一覧にある候補を、先に書いたものから選ぶ', () => {
    assert.equal(pickGroup(groups, ['g3', 'g2'])?.id, 'g3');
    assert.equal(pickGroup(groups, [null, 'g2'])?.id, 'g2');
  });

  it('一覧に無い候補（脱退した・別のアカウントのもの）は飛ばして、次の候補を見る', () => {
    assert.equal(pickGroup(groups, ['gone', 'g2'])?.id, 'g2');
  });

  it('候補が、どれも一覧に無ければ、先頭を開く', () => {
    assert.equal(pickGroup(groups, ['gone', 'other'])?.id, 'g1');
  });

  it('一覧が空なら、undefined（グループ作成へ回す側が判断する）', () => {
    assert.equal(pickGroup([], ['g1']), undefined);
  });
});
