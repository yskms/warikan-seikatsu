// 公開のWebの入口のうち、Workerが返すもの。docs/backend-design.md 9章の「公開のWebページ」。
// - 招待URL（`/invite/<トークン>`）の案内ページ。アプリが入っている端末では、OSが（Universal Links・App Links で）アプリを
//   直接開くので、この応答は見えない。アプリが入っていない端末・アプリで開けなかったときの案内。
// - Universal Links（iOS）・App Links（Android）の設定ファイル。`.well-known` はドットで始まる名前なので、静的アセットに
//   置かず、ここから返す（内容をテストで検査できる。`test/site.test.ts`）。
// 招待のトークンは、この入口では検査・保存・転送をしない（形が合うかだけ見て、案内ページを返す）。トークンを含むURLに対する
// 応答は、キャッシュさせず、リファラーにも載せない。
import { isInviteToken } from './invites.ts';

// iOS。`appIDs` は `<Team ID>.<bundle ID>`（`test/config.test.ts` が、`wrangler.jsonc` と `app.json` との一致を固定している）。
// 道は、招待URLの `/invite/*` だけ。
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: ['3L2FPFG722.com.yskms.warikanseikatsu'],
        components: [{ '/': '/invite/*', comment: '招待URL' }],
      },
    ],
  },
} as const;

// Android。`sha256_cert_fingerprints` は、アプリの署名の証明書のSHA-256（App Links は、これが一致するときだけ検証に通る）。
// **いまは、debug の署名だけ**（Expo のテンプレートの debug.keystore。誰でも持っている公開の鍵）。**リリース前に、debug のものを外し、
// Play App Signing の鍵（Playからインストールされたアプリは、この鍵で署名し直される）のSHA-256に置き換える**
// （`npm run release-check` が、debug のSHA-256が残っていれば失敗にする）。
export const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.yskms.warikanseikatsu',
      sha256_cert_fingerprints: [
        // debug.keystore（2026-11-26に計算）
        'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
      ],
    },
  },
] as const;

const INVITE_PAGE_PATH = /^\/invite\/([^/]+)$/;

function jsonFile(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    // OSが取りに来て、数時間〜数日キャッシュする。内容が変わるのは、リリースのときだけ。
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}

/** 公開のWebの入口。このWorkerが返さないパスは `null`（APIなどへ進む）。 */
export async function handleSite(request: Request, env: Pick<Env, 'ASSETS'>): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  if (pathname === '/.well-known/apple-app-site-association') {
    if (!isRead) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    return jsonFile(APPLE_APP_SITE_ASSOCIATION);
  }
  if (pathname === '/.well-known/assetlinks.json') {
    if (!isRead) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    return jsonFile(ASSET_LINKS);
  }

  const invite = INVITE_PAGE_PATH.exec(pathname);
  if (invite === null) return null;
  if (!isRead) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  // トークンの形でないものは、案内ページを出さない（ページの中の処理が、形の合わない値を扱わないように）。
  if (!isInviteToken(safeDecode(invite[1]!))) return new Response('Not found\n', { status: 404, headers: noStore('text/plain; charset=utf-8') });
  const page = await env.ASSETS.fetch(new Request(new URL('/invite', request.url), { method: 'GET' }));
  if (!page.ok) return new Response('Not found\n', { status: 404, headers: noStore('text/plain; charset=utf-8') });
  const headers = new Headers(page.headers);
  headers.set('cache-control', 'no-store');
  // トークンを含むURLを、リンク先（ストアなど）に、リファラーとして渡さない。
  headers.set('referrer-policy', 'no-referrer');
  return new Response(request.method === 'HEAD' ? null : page.body, { status: 200, headers });
}

// 不正な `%` のエンコードは、例外にせず、トークンではないものとして扱う。
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function noStore(contentType: string): Record<string, string> {
  return { 'content-type': contentType, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
}
