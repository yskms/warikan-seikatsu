/// <reference types="node" />
// 公開のWeb（worker/public/ の静的ページと、src/site.ts が返す招待URLの案内ページ・Universal Links / App Links の設定ファイル）。
// docs/backend-design.md 9章の「公開のWebページ」。
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { unstable_readConfig } from 'wrangler';
import { isInviteToken } from '../src/invites.ts';
import { APPLE_APP_SITE_ASSOCIATION, ASSET_LINKS, handleSite } from '../src/site.ts';
import { workerDir } from './localDatabase.ts';

const publicDir = path.join(workerDir, 'public');
const config = unstable_readConfig({ config: path.join(workerDir, 'wrangler.jsonc') });
const vars = (config.vars ?? {}) as Record<string, unknown>;
const app = JSON.parse(readFileSync(path.join(workerDir, '..', 'app.json'), 'utf8')) as {
  expo: {
    ios: { bundleIdentifier: string; associatedDomains: string[] };
    android: {
      package: string;
      intentFilters: Array<{ autoVerify: boolean; data: Array<{ scheme: string; host: string; pathPrefix: string }> }>;
    };
  };
};

const TOKEN = 'A'.repeat(43);
const INVITE_HTML = '<!doctype html><title>invite</title>';

/** `ASSETS` の偽物。`/invite` だけ、案内ページを返す。 */
function fakeAssets(options: { ok?: boolean } = {}) {
  const requested: string[] = [];
  const assets = {
    async fetch(request: Request): Promise<Response> {
      requested.push(new URL(request.url).pathname);
      if (options.ok === false) return new Response('missing', { status: 404 });
      return new Response(INVITE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  } as unknown as Fetcher;
  return { assets, requested };
}

const get = (pathname: string, method = 'GET') => new Request(`https://warikan-seikatsu.app${pathname}`, { method });

describe('招待URLの案内ページ（/invite/<トークン>）', () => {
  it('トークンの形なら、案内ページを返す。キャッシュさせず、リファラーに載せない', async () => {
    const { assets, requested } = fakeAssets();
    const response = await handleSite(get(`/invite/${TOKEN}`), { ASSETS: assets });
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), INVITE_HTML);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    // ASSETS へ渡すのは、トークンを含まない固定のパス（トークンを、アセットの取得にも使わない）。
    assert.deepEqual(requested, ['/invite']);
  });

  it('HEAD は本文なし', async () => {
    const { assets } = fakeAssets();
    const response = await handleSite(get(`/invite/${TOKEN}`, 'HEAD'), { ASSETS: assets });
    assert.equal(response?.status, 200);
    assert.equal(await response?.text(), '');
  });

  it('トークンの形でないもの（短い・長い・記号・不正な % の符号化）は 404。ASSETS を呼ばない', async () => {
    const { assets, requested } = fakeAssets();
    for (const value of ['short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`, `${'A'.repeat(41)}%E0%A4%A`, 'A'.repeat(42) + '.']) {
      const response = await handleSite(get(`/invite/${value}`), { ASSETS: assets });
      assert.equal(response?.status, 404, value);
      assert.equal(response?.headers.get('cache-control'), 'no-store');
    }
    assert.deepEqual(requested, []);
  });

  it('GET・HEAD 以外は 405。ほかのパスは、このWorkerの入口が扱わない（null）', async () => {
    const { assets } = fakeAssets();
    assert.equal((await handleSite(get(`/invite/${TOKEN}`, 'POST'), { ASSETS: assets }))?.status, 405);
    // APIの `/invites/:x`（複数形）や、区切りの多いパスは対象外。
    for (const pathname of ['/invites/x', '/invite', '/invite/', `/invite/${TOKEN}/extra`, '/groups', '/']) {
      assert.equal(await handleSite(get(pathname), { ASSETS: assets }), null, pathname);
    }
  });

  it('案内ページのアセットが取れないときも、404（500にしない）', async () => {
    const { assets } = fakeAssets({ ok: false });
    const response = await handleSite(get(`/invite/${TOKEN}`), { ASSETS: assets });
    assert.equal(response?.status, 404);
  });

  it('案内ページの中の処理（invite.js）が受けるトークンの形が、Workerの形（43字のbase64url）と同じ', () => {
    const script = readFileSync(path.join(publicDir, 'invite.js'), 'utf8');
    assert.match(script, /\{43\}/);
    assert.equal(isInviteToken('A'.repeat(43)), true);
    // invite.js のURLスキームは、アプリ（app.json の scheme）と同じ。
    assert.match(script, new RegExp(`'warikan-seikatsu://invite/'`));
  });
});

describe('Universal Links・App Links の設定ファイル', () => {
  it('iOS: appIDs が、Team ID・バンドルID（wrangler.jsonc・app.json）と一致し、道は招待URLだけ', async () => {
    const response = await handleSite(get('/.well-known/apple-app-site-association'), { ASSETS: fakeAssets().assets });
    assert.equal(response?.status, 200);
    assert.match(response?.headers.get('content-type') ?? '', /^application\/json/);
    const body = (await response?.json()) as typeof APPLE_APP_SITE_ASSOCIATION;
    assert.deepEqual(body, JSON.parse(JSON.stringify(APPLE_APP_SITE_ASSOCIATION)));
    const detail = body.applinks.details[0]!;
    assert.deepEqual(detail.appIDs, [`${String(vars.APPLE_TEAM_ID)}.${app.expo.ios.bundleIdentifier}`]);
    assert.deepEqual(detail.components.map((component) => component['/']), ['/invite/*']);
    // アプリ側（associatedDomains）が、このドメインを指す。
    assert.deepEqual(app.expo.ios.associatedDomains, ['applinks:warikan-seikatsu.app']);
  });

  it('Android: パッケージ名が app.json と一致し、証明書のSHA-256の形が正しい。intentFilters が、同じドメインと道を指す', async () => {
    const response = await handleSite(get('/.well-known/assetlinks.json'), { ASSETS: fakeAssets().assets });
    assert.equal(response?.status, 200);
    assert.match(response?.headers.get('content-type') ?? '', /^application\/json/);
    const body = (await response?.json()) as typeof ASSET_LINKS;
    assert.equal(body.length, 1);
    const target = body[0]!.target;
    assert.equal(target.package_name, app.expo.android.package);
    assert.ok(target.sha256_cert_fingerprints.length >= 1);
    for (const fingerprint of target.sha256_cert_fingerprints) {
      assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
    const filter = app.expo.android.intentFilters[0]!;
    assert.equal(filter.autoVerify, true);
    assert.deepEqual(filter.data, [{ scheme: 'https', host: 'warikan-seikatsu.app', pathPrefix: '/invite/' }]);
  });

  it('設定ファイルは、GET・HEAD 以外を 405 にする', async () => {
    for (const pathname of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
      assert.equal((await handleSite(get(pathname, 'POST'), { ASSETS: fakeAssets().assets }))?.status, 405);
    }
  });
});

describe('worker/public/（静的アセット）', () => {
  const pages = ['index.html', 'privacy-policy.html', 'terms.html', 'contact.html', 'invite.html'];

  it('wrangler.jsonc が、public/ を ASSETS として配る。APIと同じパスのファイルを置かない', () => {
    assert.equal(config.assets?.binding, 'ASSETS');
    assert.equal(path.resolve(workerDir, String(config.assets?.directory)), publicDir);
    // 静的ファイルが先に返るので、APIの最初の区切りと同じ名前を置くと、Workerに届かなくなる。
    const apiSegments = ['auth', 'groups', 'categories', 'expenses', 'recurring-expenses', 'transfers', 'invites'];
    for (const entry of readdirSync(publicDir)) {
      const name = entry.replace(/\.[^.]+$/, '');
      assert.equal(apiSegments.includes(name), false, `${entry} は、APIのパスと重なる`);
    }
  });

  it('ページがそろっていて、仮の値（.invalid）が残っていない。em ダッシュも使わない', () => {
    for (const page of pages) {
      assert.equal(existsSync(path.join(publicDir, page)), true, page);
    }
    for (const file of [...pages, 'site.css', 'invite.js', '_headers']) {
      const text = readFileSync(path.join(publicDir, file), 'utf8');
      assert.doesNotMatch(text, /\.invalid|not-created-yet/, file);
      assert.doesNotMatch(text, /[—―]/, `${file}: 長いダッシュは使わない`);
    }
  });

  it('ページ内のリンクが、存在するページ・アンカーを指す', () => {
    const routes = new Map<string, string>([
      ['/', 'index.html'],
      ['/privacy-policy', 'privacy-policy.html'],
      ['/terms', 'terms.html'],
      ['/contact', 'contact.html'],
    ]);
    for (const page of pages) {
      const html = readFileSync(path.join(publicDir, page), 'utf8');
      for (const match of html.matchAll(/href="(\/[^"]*)"/g)) {
        const [route, anchor] = match[1]!.split('#') as [string, string | undefined];
        if (route === '/site.css') continue;
        const target = routes.get(route);
        assert.ok(target, `${page}: ${match[1]} の行き先が無い`);
        if (anchor !== undefined) {
          assert.match(readFileSync(path.join(publicDir, target), 'utf8'), new RegExp(`id="${anchor}"`), `${page}: #${anchor}`);
        }
      }
    }
  });

  it('法務ページの URL（アプリの legalUrls.ts）が、public/ のページに対応する', () => {
    const source = readFileSync(path.join(workerDir, '..', 'src', 'legal', 'legalUrls.ts'), 'utf8');
    for (const [name, file] of [
      ['PRIVACY_POLICY_URL', 'privacy-policy.html'],
      ['TERMS_OF_SERVICE_URL', 'terms.html'],
      ['CONTACT_URL', 'contact.html'],
    ] as const) {
      const url = new RegExp(`export const ${name} = '([^']*)';`).exec(source)?.[1];
      assert.ok(url, name);
      assert.equal(new URL(url).host, 'warikan-seikatsu.app', name);
      assert.equal(existsSync(path.join(publicDir, file)), true, `${name} の行き先 ${file}`);
      assert.equal(new URL(url).pathname, `/${file.replace(/\.html$/, '')}`, name);
    }
  });

  it('お問い合わせの窓口（メール）が、お問い合わせ・プライバシーポリシーに載っている', () => {
    for (const page of ['contact.html', 'privacy-policy.html']) {
      assert.match(readFileSync(path.join(publicDir, page), 'utf8'), /mailto:support@warikan-seikatsu\.app/, page);
    }
  });

  it('アカウント削除の手順（Google Play が求める、Webの案内）が、プライバシーポリシーのアンカーにある', () => {
    const html = readFileSync(path.join(publicDir, 'privacy-policy.html'), 'utf8');
    assert.match(html, /id="account-deletion"/);
    assert.match(html, /アカウントを削除/);
  });

  it('_headers: 外部への通信と、スクリプトの外部読み込みを、CSPで禁止する', () => {
    const headers = readFileSync(path.join(publicDir, '_headers'), 'utf8');
    assert.match(headers, /default-src 'none'/);
    assert.match(headers, /script-src 'self'/);
    assert.match(headers, /Referrer-Policy: no-referrer/);
    // connect-src を足さない（足すと、案内ページのスクリプトが、トークンを外へ送れるようになる）。
    assert.doesNotMatch(headers, /connect-src/);
  });
});
