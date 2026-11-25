// リリース前の確認: 公開前の仮の値（`.invalid`）が残っていないこと。**`npm run release-check` のときだけ動く**（普段の `npm test` では
// 飛ばす）。仮の値のままでも、アプリは動く（リンクの行が出ないだけ）ので、置き換え漏れは、画面を見ても気づけない。ストア用のビルド・
// 提出の前に実行して、失敗が無いことを確かめる。
//
// 仮の値が残っているあいだ失敗するのが正しい動作（`npm test` には入れない理由）。確かめているのは、次の3種類（値は5つ）。
// - プライバシーポリシー・利用規約・お問い合わせのページ（`src/legal/legalUrls.ts`）。ストアの掲載情報にも同じURLを入れる
// - 招待URLの置き場（`src/services/inviteUrl.ts` の `INVITE_URL_ORIGIN`）。Universal Links / App Links の設定も要る
// - APIの置き場（`src/repositories/apiClient.ts` の `API_ORIGIN`）。Workerの `APPLE_CALLBACK_URL` と同じドメインにする
// お問い合わせを、Webページ以外の窓口にすると決めたときは、ここの確認も、その形に合わせて直す。
//
// **見ているのは、`.invalid` が残っていないことだけ**。開発用のドメイン（`workers.dev` やローカルのURLなど）に置き換えたまま
// 出しても、通る。Workerの設定（`worker/wrangler.jsonc`）は見ない: ただし、`API_ORIGIN` と `APPLE_CALLBACK_URL` が同じ origin か
// は、Workerのテスト（`worker/test/config.test.ts`。`worker/` の `npm test`。ルートの `npm test` には入らない）が見ているので、
// 片方だけ置き換えると、そちらで失敗する。本番のドメインを決めるときに、見る範囲を見直す。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { API_ORIGIN } from '../repositories/apiClient.ts';
import { INVITE_URL_ORIGIN } from '../services/inviteUrl.ts';
import { CONTACT_URL, isPlaceholderUrl, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from './legalUrls.ts';

const enabled = process.env.RELEASE_CHECK === '1';

describe('リリース前の確認（仮の値が残っていないこと）', { skip: enabled ? false : '`npm run release-check` のときだけ動く' }, () => {
  const values: ReadonlyArray<readonly [name: string, file: string, value: string]> = [
    ['PRIVACY_POLICY_URL', 'src/legal/legalUrls.ts', PRIVACY_POLICY_URL],
    ['TERMS_OF_SERVICE_URL', 'src/legal/legalUrls.ts', TERMS_OF_SERVICE_URL],
    ['CONTACT_URL', 'src/legal/legalUrls.ts', CONTACT_URL],
    ['INVITE_URL_ORIGIN', 'src/services/inviteUrl.ts', INVITE_URL_ORIGIN],
    ['API_ORIGIN', 'src/repositories/apiClient.ts', API_ORIGIN],
  ];
  for (const [name, file, value] of values) {
    it(`${name} が仮の値のままではない`, () => {
      assert.equal(isPlaceholderUrl(value), false, `${name}（${file}）が、仮の値（${value}）のまま`);
    });
  }

  // debug.keystore（Expoのテンプレートのもの。誰でも持っている公開の鍵）のSHA-256が、App Links の設定（assetlinks.json。`worker/src/site.ts`
  // の `ASSET_LINKS`）に残っていないこと。残すと、同じパッケージ名で debug 鍵の署名のアプリが、招待URLの検証に通る。リリース前に、
  // Play App Signing の鍵のSHA-256に置き換える。
  it('assetlinks.json（worker/src/site.ts）に、debug の署名のSHA-256が残っていない', () => {
    const DEBUG_SHA256 = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
    const source = readFileSync(new URL('../../worker/src/site.ts', import.meta.url), 'utf8');
    assert.equal(
      source.includes(DEBUG_SHA256),
      false,
      'worker/src/site.ts の ASSET_LINKS に、debug 鍵のSHA-256が残っている（Play App Signing の鍵のSHA-256に置き換える）',
    );
  });
});
