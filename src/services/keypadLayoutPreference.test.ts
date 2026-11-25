// キーパッドの並びの設定（メモリと端末）のテスト。`npm test` で実行する。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KeypadLayout } from './keypadLayout.ts';
import { createKeypadLayoutPreference } from './keypadLayoutPreference.ts';

/** 読み込みを、好きなときに終わらせられる偽の保存先 */
function fakeStorage() {
  const saved: KeypadLayout[] = [];
  let finishLoad: (value: string | null) => void = () => {};
  let failLoad: (error: Error) => void = () => {};
  const loaded = new Promise<string | null>((resolve, reject) => {
    finishLoad = resolve;
    failLoad = reject;
  });
  let loads = 0;
  let saveError: Error | null = null;
  return {
    saved,
    get loads() {
      return loads;
    },
    finishLoad,
    failLoad,
    failSave(error: Error) {
      saveError = error;
    },
    storage: {
      load: () => {
        loads += 1;
        return loaded;
      },
      save: async (value: KeypadLayout) => {
        if (saveError !== null) throw saveError;
        saved.push(value);
      },
    },
  };
}

describe('キーパッドの並びの設定', () => {
  it('何も覚えていなければ、スマホ', async () => {
    const fake = fakeStorage();
    const pref = createKeypadLayoutPreference(fake.storage);
    assert.equal(pref.get(), 'phone');
    const started = pref.start();
    fake.finishLoad(null);
    await started;
    assert.equal(pref.get(), 'phone');
  });

  it('覚えていた並びを、起動時に読む', async () => {
    const fake = fakeStorage();
    const pref = createKeypadLayoutPreference(fake.storage);
    let notified = 0;
    pref.subscribe(() => (notified += 1));
    const started = pref.start();
    fake.finishLoad('calculator\n');
    await started;
    assert.equal(pref.get(), 'calculator');
    assert.equal(notified, 1);
  });

  it('知らない値・読めない失敗は、スマホのまま（投げない）', async () => {
    const unknown = fakeStorage();
    const a = createKeypadLayoutPreference(unknown.storage);
    const startedA = a.start();
    unknown.finishLoad('numpad');
    await startedA;
    assert.equal(a.get(), 'phone');

    const broken = fakeStorage();
    const b = createKeypadLayoutPreference(broken.storage);
    const startedB = b.start();
    broken.failLoad(new Error('読めない'));
    await startedB;
    assert.equal(b.get(), 'phone');
  });

  it('読み込みは1回だけ（何度 start しても、同じ読み込みを待つ）', async () => {
    const fake = fakeStorage();
    const pref = createKeypadLayoutPreference(fake.storage);
    const first = pref.start();
    const second = pref.start();
    fake.finishLoad('calculator');
    await Promise.all([first, second]);
    assert.equal(fake.loads, 1);
  });

  it('選ぶと、すぐ反映して、端末にも覚える', async () => {
    const fake = fakeStorage();
    const pref = createKeypadLayoutPreference(fake.storage);
    const done = pref.choose('calculator');
    assert.equal(pref.get(), 'calculator');
    await done;
    assert.deepEqual(fake.saved, ['calculator']);
  });

  it('端末へ覚えるのに失敗しても、選んだ並びのまま（投げない）', async () => {
    const fake = fakeStorage();
    fake.failSave(new Error('書けない'));
    const pref = createKeypadLayoutPreference(fake.storage);
    await pref.choose('calculator');
    assert.equal(pref.get(), 'calculator');
  });

  it('読み込みが終わる前に選んだら、あとから届いた古い値で上書きしない', async () => {
    const fake = fakeStorage();
    const pref = createKeypadLayoutPreference(fake.storage);
    const started = pref.start();
    await pref.choose('calculator');
    fake.finishLoad('phone');
    await started;
    assert.equal(pref.get(), 'calculator');
  });
});
