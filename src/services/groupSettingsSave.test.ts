// グループの設定の保存の手順のテスト。`npm test` で実行する。送る順（グループ名・通貨 → 自分の表示名・色）と、途中の失敗で止まること、
// 済んだ段階が基準に取り込まれて、やり直しで残りだけが送られることを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuthError } from '../repositories/authError.ts';
import { checkSettings, type GroupSettingsContext, type GroupSettingsDraft, type GroupSettingsPlan } from './groupSettingsForm.ts';
import { saveSettings } from './groupSettingsSave.ts';

const context: GroupSettingsContext = {
  baseline: { name: 'ふたりの生活費', displayName: 'あなた', color: 'pink', currencyCode: 'JPY' },
  access: { canEditGroup: true, canEditCurrency: true, currencyLocked: false },
};

function service(fail: { group?: Error; me?: Error } = {}) {
  const log: string[] = [];
  return {
    log,
    service: {
      async updateGroup(groupId: string, request: object) {
        log.push(`group:${groupId}:${JSON.stringify(request)}`);
        if (fail.group) throw fail.group;
      },
      async updateMe(groupId: string, request: object) {
        log.push(`me:${groupId}:${JSON.stringify(request)}`);
        if (fail.me) throw fail.me;
      },
    },
  };
}

function planOf(draft: GroupSettingsDraft, base: GroupSettingsContext = context): GroupSettingsPlan {
  const check = checkSettings(draft, base);
  assert.ok(check.ok);
  return check.plan;
}

const edited: GroupSettingsDraft = { name: '新', displayName: 'ゆ', color: 'blue', currencyCode: 'USD' };

describe('saveSettings', () => {
  it('グループ名・通貨 → 自分の表示名・色の順に送り、済んだ内容を基準に取り込んで返す', async () => {
    const { log, service: s } = service();
    const result = await saveSettings(s, 'g1', planOf(edited), context);
    assert.deepEqual(log, ['group:g1:{"name":"新","currencyCode":"USD"}', 'me:g1:{"displayName":"ゆ","color":"blue"}']);
    assert.ok(result.ok);
    assert.deepEqual(result.context.baseline, edited);
  });

  it('送るものが無い側の呼び出しは、しない', async () => {
    const onlyMe = service();
    await saveSettings(onlyMe.service, 'g1', planOf({ ...context.baseline, color: 'blue' }), context);
    assert.deepEqual(onlyMe.log, ['me:g1:{"color":"blue"}']);
    const onlyGroup = service();
    await saveSettings(onlyGroup.service, 'g1', planOf({ ...context.baseline, name: '新' }), context);
    assert.deepEqual(onlyGroup.log, ['group:g1:{"name":"新"}']);
  });

  it('グループ名・通貨が失敗したら、自分の表示名・色は送らない。何も保存されていない', async () => {
    const error = new AuthError('network');
    const { log, service: s } = service({ group: error });
    const result = await saveSettings(s, 'g1', planOf(edited), context);
    assert.deepEqual(log, ['group:g1:{"name":"新","currencyCode":"USD"}']);
    assert.ok(!result.ok);
    assert.deepEqual([result.step, result.saved, result.error], ['group', false, error]);
    assert.deepEqual(result.context, context);
  });

  it('自分の表示名・色が失敗したら、グループ名・通貨は保存済みとして返す。やり直しでは、残りだけが送られる', async () => {
    const error = new AuthError('unavailable');
    const first = service({ me: error });
    const result = await saveSettings(first.service, 'g1', planOf(edited), context);
    assert.ok(!result.ok);
    assert.deepEqual([result.step, result.saved, result.error], ['me', true, error]);
    assert.equal(result.context.baseline.name, '新');
    assert.equal(result.context.baseline.currencyCode, 'USD');
    assert.equal(result.context.baseline.displayName, 'あなた');

    // 画面は、返された基準で差分を組み立て直して、もう一度押される
    const retry = service();
    const again = await saveSettings(retry.service, 'g1', planOf(edited, result.context), result.context);
    assert.deepEqual(retry.log, ['me:g1:{"displayName":"ゆ","color":"blue"}']);
    assert.ok(again.ok);
    assert.deepEqual(again.context.baseline, edited);
  });
});
