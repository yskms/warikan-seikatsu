// グループの設定を保存できなかったときの文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { GroupRejectedError } from '../repositories/groupRepository.ts';
import { discardNote, saveErrorMessage, saveLostGroup, shouldReloadAfterSave } from './groupSettingsMessage.ts';

const rejected = (reason: string | null, status = 409) => new GroupRejectedError(status, reason);

describe('shouldReloadAfterSave', () => {
  it('変えられるものが変わったと分かる断り（脱退が確定した・通貨が固定された）のときだけ、読み直す', () => {
    assert.equal(shouldReloadAfterSave(rejected('forbidden', 403)), true);
    assert.equal(shouldReloadAfterSave(rejected('currency_locked')), true);
  });

  it('競合・グループが無い・入力の食い違い・通信の失敗は、読み直さない（同じ内容の送り直しは、結果が変わらない）', () => {
    for (const error of [
      rejected('conflict'),
      rejected('not_found', 404),
      rejected('invalid_request', 400),
      rejected(null),
      new AuthError('network'),
      new AuthError('invalid-response'),
      new Error('x'),
    ]) {
      assert.equal(shouldReloadAfterSave(error), false);
    }
  });
});

describe('saveLostGroup', () => {
  it('404 not_found（グループが消えた・脱退済みになった）だけ、所属の一覧を読み直す', () => {
    assert.equal(saveLostGroup(rejected('not_found', 404)), true);
    assert.equal(saveLostGroup(rejected('conflict')), false);
    assert.equal(saveLostGroup(new AuthError('network')), false);
  });
});

describe('saveErrorMessage', () => {
  it('失敗した段階を頭に置く。グループ名・通貨が済んでいれば、それを先に伝える', () => {
    const network = new AuthError('network');
    assert.ok(saveErrorMessage(network, 'group', false).startsWith('グループ名・通貨を保存できませんでした。'));
    assert.ok(saveErrorMessage(network, 'me', false).startsWith('自分の表示名・色を保存できませんでした。'));
    assert.ok(
      saveErrorMessage(network, 'me', true).startsWith('グループ名・通貨は保存しました。自分の表示名・色を保存できませんでした。'),
    );
  });

  it('通信・混雑・応答の不備は、もう一度の案内。断られた理由は、それぞれの文言', () => {
    assert.match(saveErrorMessage(new AuthError('network'), 'group', false), /通信できませんでした/);
    assert.match(saveErrorMessage(new AuthError('unavailable'), 'group', false), /混み合って/);
    assert.match(saveErrorMessage(new AuthError('invalid-response'), 'group', false), /応答を読み取れませんでした/);
    assert.match(saveErrorMessage(rejected('forbidden', 403), 'group', false), /脱退が確定した人は/);
    assert.match(saveErrorMessage(rejected('currency_locked'), 'group', false), /通貨を変えられません/);
    assert.match(saveErrorMessage(rejected('conflict'), 'me', false), /もう一度お試しください/);
    assert.match(saveErrorMessage(rejected('not_found', 404), 'me', false), /グループを開けませんでした/);
    assert.match(saveErrorMessage(rejected('invalid_request', 400), 'me', false), /最新の版に更新/);
    assert.match(saveErrorMessage(rejected(null), 'me', false), /最新の版に更新/);
  });

  it('ログインの問題は、段階によらず、ログインの案内', () => {
    for (const code of ['unauthorized', 'not-signed-in'] as const) {
      assert.match(saveErrorMessage(new AuthError(code), 'me', true), /ログインを確認できませんでした/);
    }
    assert.match(saveErrorMessage(new AuthError('storage-failed'), 'group', false), /ログイン情報を読み取れませんでした/);
  });
});

describe('discardNote', () => {
  it('グループ名・通貨が保存済みなら、破棄しても戻らないことを伝える', () => {
    assert.match(discardNote(true), /すでに保存されています/);
    assert.equal(discardNote(false), '入力した内容は保存されません。');
  });
});
