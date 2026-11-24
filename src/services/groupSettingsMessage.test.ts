// グループの設定を保存できなかったときの文言のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { GroupRejectedError } from '../repositories/groupRepository.ts';
import { discardNote, saveErrorMessage, saveLostGroup, saveResultUnknown, shouldReloadAfterSave } from './groupSettingsMessage.ts';

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

describe('saveResultUnknown', () => {
  it('通信が切れた・混雑・応答が読めない失敗は、済んだか分からない。サーバーが断った失敗・ログインの失敗は、分かっている', () => {
    for (const code of ['network', 'unavailable', 'invalid-response'] as const) {
      assert.equal(saveResultUnknown(new AuthError(code)), true, code);
    }
    for (const error of [
      rejected('forbidden', 403),
      rejected('conflict'),
      rejected('not_found', 404),
      rejected(null),
      new AuthError('unauthorized'),
      new AuthError('not-signed-in'),
      new AuthError('storage-failed'),
    ]) {
      assert.equal(saveResultUnknown(error), false);
    }
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

  it('グループ名・通貨で止まって、自分の表示名・色を送っていないときは、そちらもまだ保存していないことを伝える', () => {
    const forbidden = rejected('currency_locked');
    const sent = saveErrorMessage(forbidden, 'group', false, true);
    assert.ok(sent.startsWith('グループ名・通貨を保存できませんでした。自分の表示名・色も、まだ保存していません。'));
    // 送るものが無かった（`meNotSent` が偽）ときは、足さない。2つ目で失敗したときも、足さない
    assert.ok(!saveErrorMessage(forbidden, 'group', false, false).includes('まだ保存していません'));
    assert.ok(!saveErrorMessage(forbidden, 'group', false).includes('まだ保存していません'));
    assert.ok(!saveErrorMessage(forbidden, 'me', true, false).includes('まだ保存していません'));
  });

  it('グループ名・通貨が済んだあとの、通信の失敗（2つ目）は、保存できたことを先に伝えて、もう一度の案内', () => {
    const message = saveErrorMessage(new AuthError('network'), 'me', true);
    assert.ok(message.startsWith('グループ名・通貨は保存しました。自分の表示名・色を保存できませんでした。'));
    assert.match(message, /通信できませんでした/);
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
  it('グループ名・通貨が保存済みなら、さきほど保存したものは戻らず、いま入力している変更は保存されないことを伝える', () => {
    // 保存したあとにグループ名をもう一度変えていても、本文が事実と合う（「さきほど」と、保存した時点を示す）
    assert.equal(
      discardNote(true),
      'さきほど保存したグループ名・通貨は、元に戻りません。いま入力している変更は、保存されません。',
    );
    assert.equal(discardNote(false), '入力した内容は保存されません。');
  });
});
