/// <reference types="node" />
// wrangler.jsonc の、変えてはいけない方針を固定する。Singfolio（worker/test/config.test.ts）のうち、このアプリにあるものだけ
// （コピー元: singfolio 61e0a82）。変えるときは、docs/backend-design.md と一緒に直す。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { unstable_readConfig } from 'wrangler';
import { PLACEHOLDER_MARKER, placeholderVars } from '../scripts/checkPlaceholders.ts';
import { APP_RETURN_URL } from '../src/appleWeb.ts';
import { workerDir } from './localDatabase.ts';

const config = unstable_readConfig({ config: path.join(workerDir, 'wrangler.jsonc') });
const vars = (config.vars ?? {}) as Record<string, unknown>;

// Google Cloudで、サーバー用（Web）のクライアントIDを作るまでの、実在しない値（wrangler.jsonc）。
const GOOGLE_PLACEHOLDER = '0-not-created-yet.apps.googleusercontent.com';
// Apple Developerで、Sign in with Apple の鍵を作るまでの、実在しない値（wrangler.jsonc）。
const APPLE_KEY_PLACEHOLDER = '0-not-created-yet';
// Apple Developerで、Services ID を作るまでの、実在しない値（wrangler.jsonc）。
const APPLE_SERVICES_PLACEHOLDER = '0-not-created-yet';
// 本番の独自ドメインが決まる前の、実在しない値（いまの wrangler.jsonc は、本番のドメインに置き換え済み）。仮の値を見つける
// 確認（`placeholderVars`）の検査にだけ使う。`.invalid` は、実在しないことが決まっているTLD。
const APPLE_CALLBACK_PLACEHOLDER = 'https://not-created-yet.invalid/auth/apple/callback';

describe('wrangler.jsonc', () => {
  it('Workers Logs は無効（認証の値が、ログに残らないようにするため）', () => {
    // 資料は、記録に含まれるヘッダー（Authorization など）と、invocation_logs を false にしたときの
    // console.log のメタデータを書いていない。確かめずに有効にしない。
    assert.equal(config.observability?.enabled, false);
    // 有効にされても、クエリ文字列（招待の値など）をログに残さないための安全弁。
    assert.equal(config.observability?.redact_query_string, true);
  });

  it('workers.dev とプレビューのURLは出さない', () => {
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
  });

  it('秘密情報は wrangler.jsonc に値を書かない（vars に置かない）', () => {
    assert.equal(config.secrets?.required?.includes('NONCE_HMAC_KEY'), true);
    // Appleのトークンの失効（POST /auth/delete）に署名する鍵。無いまま本番に出すと、失効が行われない（削除は止まらない）。
    assert.equal(config.secrets?.required?.includes('APPLE_PRIVATE_KEY'), true);
    for (const name of config.secrets?.required ?? []) {
      assert.equal(name in vars, false, `${name} を vars に置かない`);
    }
  });

  it('IDトークンの aud（vars）は、アプリの設定と食い違っていない', () => {
    const app = JSON.parse(readFileSync(path.join(workerDir, '..', 'app.json'), 'utf8')) as {
      expo: { ios: { bundleIdentifier: string } };
    };
    // Appleのネイティブのトークンの aud は、アプリのバンドルID（iOS）。ずれると、すべてのAppleログインが拒否される。
    assert.equal(vars.APPLE_BUNDLE_ID, app.expo.ios.bundleIdentifier);
    // Googleの aud は、サーバー用（Web）のクライアントID。iOS・Androidのクライアントではない。
    // まだ作っていない間は、実在しない値のまま（Googleログインは、どのトークンも拒否される）。
    assert.ok(
      vars.GOOGLE_WEB_CLIENT_ID === GOOGLE_PLACEHOLDER ||
        /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(String(vars.GOOGLE_WEB_CLIENT_ID)),
      'GOOGLE_WEB_CLIENT_ID が、クライアントIDの形でも、置き場所の値でもない',
    );
  });

  // このアプリで足したテスト。Googleのトークンの `aud`（Worker）は、アプリがサインインに使うサーバー用（Web）のクライアントID
  // （`app.json` の `plugins` の `plugins/withGoogleSignIn.js` の `webClientId`）と同じ。ずれると、すべてのGoogleログインが拒否される。
  it('GOOGLE_WEB_CLIENT_ID が、アプリ（app.json の withGoogleSignIn の webClientId）と同じ', () => {
    const app = JSON.parse(readFileSync(path.join(workerDir, '..', 'app.json'), 'utf8')) as {
      expo: { plugins: Array<string | [string, Record<string, string>]> };
    };
    const entry = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === './plugins/withGoogleSignIn.js');
    assert.ok(Array.isArray(entry), 'app.json に withGoogleSignIn の設定が無い');
    assert.equal(entry[1].webClientId, vars.GOOGLE_WEB_CLIENT_ID);
    // iOSのクライアントは、Webのクライアントとは別のID（同じにすると、aud でどちらか区別できない）。
    assert.notEqual(entry[1].iosClientId, entry[1].webClientId);
  });

  it('Appleのトークンの失効に使う識別子（vars）の形', () => {
    // Team ID は10文字の英大文字・数字。Key ID は、Sign in with Apple の鍵を作るまでは、置き場所の値のまま
    // （仮の値でも、失効が行われないだけで、アカウントの削除は止まらない）。
    assert.match(String(vars.APPLE_TEAM_ID), /^[A-Z0-9]{10}$/);
    assert.ok(
      vars.APPLE_KEY_ID === APPLE_KEY_PLACEHOLDER || /^[A-Z0-9]{10}$/.test(String(vars.APPLE_KEY_ID)),
      'APPLE_KEY_ID が、Key ID の形でも、置き場所の値でもない',
    );
  });

  it('AndroidのAppleログイン（Web経由）の識別子（vars）の形と、アプリのURLスキームとの一致', () => {
    const app = JSON.parse(readFileSync(path.join(workerDir, '..', 'app.json'), 'utf8')) as {
      expo: { scheme: string; ios: { bundleIdentifier: string } };
    };
    // Services ID は、App ID（バンドルID）とは別の識別子。同じ値にすると、`aud` でネイティブと web を区別できない。
    // 作るまでは、置き場所の値のまま（AndroidのAppleログインは通らない）。
    assert.ok(
      vars.APPLE_SERVICES_ID === APPLE_SERVICES_PLACEHOLDER || /^[A-Za-z0-9]+(\.[A-Za-z0-9-]+)+$/.test(String(vars.APPLE_SERVICES_ID)),
      'APPLE_SERVICES_ID が、Services ID の形でも、置き場所の値でもない',
    );
    assert.notEqual(vars.APPLE_SERVICES_ID, app.expo.ios.bundleIdentifier);
    // Return URL は、HTTPSで、このWorkerのコールバックのパス（src/index.ts）。Appleは、HTTPや、パスの違うURLを受け付けない。
    assert.ok(
      vars.APPLE_CALLBACK_URL === APPLE_CALLBACK_PLACEHOLDER ||
        /^https:\/\/[a-z0-9.-]+\/auth\/apple\/callback$/.test(String(vars.APPLE_CALLBACK_URL)),
      'APPLE_CALLBACK_URL が、コールバックのURLの形でも、置き場所の値でもない',
    );
    // コールバックが戻すURLスキームは、アプリの `scheme`（app.json）。ずれると、Androidのアプリに戻れない。
    assert.equal(new URL(APP_RETURN_URL).protocol, `${app.expo.scheme}:`);
  });

  // このアプリで足したテスト（Singfolioは、アプリ側の値をコードの定数で持ち、Workerの `vars` に置かないので、無い）。
  // Services ID・Return URL は、Worker（vars）とアプリ（認可のURLを作る）に、同じ値を書く（コードは共有しない）。
  // 片方だけ置き換えると、Appleが認可の画面を出さない・認可コードの交換が `invalid_client` になる。アプリのソースは、
  // 読むだけ（import しない）。
  it('AndroidのAppleログインの識別子・戻り先が、アプリ側（src/repositories/appleWebSignInRepository.ts）と同じ', () => {
    const source = readFileSync(
      path.join(workerDir, '..', 'src', 'repositories', 'appleWebSignInRepository.ts'),
      'utf8',
    );
    const appConstant = (name: string) => new RegExp(`^export const ${name} = '([^']*)';$`, 'm').exec(source)?.[1];
    assert.equal(appConstant('APPLE_SERVICES_ID'), vars.APPLE_SERVICES_ID);
    assert.equal(appConstant('APPLE_CALLBACK_URL'), vars.APPLE_CALLBACK_URL);
    assert.equal(appConstant('APP_RETURN_URL'), APP_RETURN_URL);
    // アプリが「仮の値のまま」を見分ける印は、Workerのデプロイの確認と同じ。
    assert.equal(appConstant('PLACEHOLDER_MARKER'), PLACEHOLDER_MARKER);
  });

  // このアプリで足したテスト。アプリがAPIを呼ぶ先（`API_ORIGIN`）と、Appleが戻す先（`APPLE_CALLBACK_URL`）は、同じWorkerの
  // 同じドメイン（本番の入口は独自ドメイン1つ。上の `workers_dev`・`preview_urls`）。片方だけ置き換えると、ログインのAPIは
  // 通るのに、Appleの戻りが届かない（または逆）。ドメインを分ける設計にするときは、このテストを直す。
  it('アプリがAPIを呼ぶ先（src/repositories/apiClient.ts の API_ORIGIN）が、Appleの Return URL と同じドメイン', () => {
    const source = readFileSync(path.join(workerDir, '..', 'src', 'repositories', 'apiClient.ts'), 'utf8');
    const apiOrigin = /^export const API_ORIGIN = '([^']*)';$/m.exec(source)?.[1];
    assert.ok(apiOrigin, 'API_ORIGIN が見つからない');
    assert.equal(apiOrigin, new URL(String(vars.APPLE_CALLBACK_URL)).origin);
    // 仮の値のあいだは、どちらも、デプロイの確認とアプリが見分ける印を含む。
    assert.equal(apiOrigin.includes(PLACEHOLDER_MARKER), String(vars.APPLE_CALLBACK_URL).includes(PLACEHOLDER_MARKER));
  });

  // このアプリで足したテスト。入口は独自ドメイン1つ（Singfolioと同じ。`custom_domain: true` は、デプロイで、DNSの記録と証明書を作る）。
  // `routes` のドメインと、Appleの Return URL（と、同じドメインにしている `API_ORIGIN`）がずれると、アプリが呼ぶ先に、
  // Workerが付いていない。`pattern` にパスやワイルドカードを書かない（Custom Domainは、ホスト名だけを受け付ける）。
  it('入口は独自ドメイン1つ（routes の Custom Domain）で、Appleの Return URL と同じホスト', () => {
    const routes = (config.routes ?? []) as Array<{ pattern: string; custom_domain?: boolean }>;
    assert.equal(routes.length, 1);
    assert.equal(routes[0].custom_domain, true);
    assert.match(routes[0].pattern, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    assert.equal(routes[0].pattern, new URL(String(vars.APPLE_CALLBACK_URL)).host);
  });

  it('仮の値が vars に残ったままでは、デプロイできない（npm run deploy の前の確認）', () => {
    const pkg = JSON.parse(readFileSync(path.join(workerDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts.predeploy ?? '', /scripts\/checkPlaceholders\.ts/);
    // 仮の値は、確認が見つけられる印を含む。
    assert.equal(GOOGLE_PLACEHOLDER.includes(PLACEHOLDER_MARKER), true);
    assert.equal(APPLE_KEY_PLACEHOLDER.includes(PLACEHOLDER_MARKER), true);
    assert.equal(APPLE_SERVICES_PLACEHOLDER.includes(PLACEHOLDER_MARKER), true);
    assert.equal(APPLE_CALLBACK_PLACEHOLDER.includes(PLACEHOLDER_MARKER), true);
    assert.deepEqual(placeholderVars({ GOOGLE_WEB_CLIENT_ID: GOOGLE_PLACEHOLDER, APPLE_BUNDLE_ID: 'com.example.app' }), [
      'GOOGLE_WEB_CLIENT_ID',
    ]);
    assert.deepEqual(placeholderVars({ GOOGLE_WEB_CLIENT_ID: '123-abc.apps.googleusercontent.com' }), []);
    assert.deepEqual(placeholderVars({ APPLE_KEY_ID: APPLE_KEY_PLACEHOLDER, APPLE_TEAM_ID: 'ABCDE12345' }), ['APPLE_KEY_ID']);
    assert.deepEqual(placeholderVars({ APPLE_KEY_ID: 'ABCDE12345' }), []);
    assert.deepEqual(
      placeholderVars({ APPLE_SERVICES_ID: APPLE_SERVICES_PLACEHOLDER, APPLE_CALLBACK_URL: APPLE_CALLBACK_PLACEHOLDER }),
      ['APPLE_SERVICES_ID', 'APPLE_CALLBACK_URL'],
    );
    assert.deepEqual(placeholderVars({ N: 1, M: null }), []);
  });

  it('HTTPS検査を迂回する設定を vars に置かない', () => {
    // 検査は、localhost のホスト名だけを通す。環境変数などで切る口は作らない（src/https.ts）。
    for (const name of Object.keys(vars)) {
      assert.doesNotMatch(name, /insecure|http|ssl|tls/i, `${name}: HTTPS検査を切る口にならないか確認する`);
    }
  });

  it('.dev.vars.example に、必須の秘密情報がすべて載っている', () => {
    const example = readFileSync(path.join(workerDir, '.dev.vars.example'), 'utf8');
    for (const name of config.secrets?.required ?? []) {
      assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} が .dev.vars.example に無い`);
    }
  });
});
