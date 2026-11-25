// AndroidのAppleログイン（Web経由）。Appleの認可の画面（Custom Tab）を開き、アプリのURLスキームへの戻りから、
// 認可コードを取り出す。サインインの層（`accountService`）に `AuthCodeProvider` として渡す（Androidだけ。`platform/accountService.ts`）。
// 画面・サインインの層は、URL・ブラウザの扱いを知らない。方式は docs/backend-design.md 9章の「認証API」
// （AndroidのAppleログイン）。Singfolio（src/repositories/appleWebSignInRepository.ts）からのコピーを元にした
// （コピー元: singfolio 89ad088）。Singfolio側を直したときは、差分を手で取り込む。
//
// このアプリで変えたところ:
// - Services ID・Return URL・戻り先のURLスキームの値（Workerの `wrangler.jsonc` の `vars` と、`worker/src/appleWeb.ts` と同じ。
//   `worker/test/config.test.ts` が、一致を固定している）。どちらも、作った実際の値（Return URL は本番のドメイン `warikan-seikatsu.app`）。
//   どちらかが仮の値（`not-created-yet` を含む）のあいだは、ブラウザを開かず
//   `provider-unavailable` で断る（Appleの「無効なクライアント」の画面を出して、利用者が閉じた（`cancelled`）ように
//   見せないため）。
// - 認可のURLの組み立てと、断る判定が、設定（`AppleWebConfig`）を受け取れる（Nodeのテストが、設定済みの状態を作れるように）。
//
// ブラウザ（expo-web-browser）・URLの受け取り（Linking）・前面への復帰（AppState）は注入する（`platform/authBrowser.ts`）。
// `src/` はNodeのテストから直接実行するので、ここでは import しない（Nodeのテストは偽物で動かす）。
//
// 守ること:
// - 認可リクエストに、名前・メールのスコープを付けない（`scope` を送らない。使うのは `sub` だけ）。
//   スコープが無いので、`response_mode=query` でよい（スコープを付けると `form_post` が必須になる）。
// - `state` と `nonce` には、渡された `SHA-256(T)` をそのまま入れる。戻ってきた `state` が違うURLは、自分の
//   フローのものではない（他のアプリが押し込んだものなど）ので、受け取らず、待ち続ける。
// - 認可コード・`state` を、エラーの `message` にもログにも出さない。失敗は `code`（`AuthError`）だけで伝える。
// - 戻り先のURLスキーム（`warikan-seikatsu://auth/apple`）は、Worker（`/auth/apple/callback`）が固定で持つ値と同じ。
import { AuthError } from './authError.ts';

/** Apple の Services ID（Webのサインインの `client_id`）。Workerの `APPLE_SERVICES_ID` と同じ（Return URL を登録した名前）。 */
export const APPLE_SERVICES_ID = 'com.yskms.warikanseikatsu.web';
/** Services ID の Return URL。Worker のコールバック。ここから、アプリのURLスキームへ 302 で戻る。Workerの `APPLE_CALLBACK_URL` と同じ。 */
export const APPLE_CALLBACK_URL = 'https://warikan-seikatsu.app/auth/apple/callback';
/** Workerのコールバックが、アプリへ戻すURL。アプリのURLスキーム（app.json の `scheme`）で始まる。 */
export const APP_RETURN_URL = 'warikan-seikatsu://auth/apple';

/** まだ作っていない値の置き場所（仮の値）に含める印。Workerの `scripts/checkPlaceholders.ts` の `PLACEHOLDER_MARKER` と同じ。 */
export const PLACEHOLDER_MARKER = 'not-created-yet';

export interface AppleWebConfig {
  /** Services ID（`client_id`） */
  servicesId: string;
  /** Return URL（`redirect_uri`） */
  callbackUrl: string;
}

const APPLE_WEB_CONFIG: AppleWebConfig = {
  servicesId: APPLE_SERVICES_ID,
  callbackUrl: APPLE_CALLBACK_URL,
};

/** Services ID・Return URL が、実際の値に置き換えてあるか（仮の値のままだと、Appleの認可の画面は使えない）。 */
export function isAppleWebConfigured(config: AppleWebConfig = APPLE_WEB_CONFIG): boolean {
  return !config.servicesId.includes(PLACEHOLDER_MARKER) && !config.callbackUrl.includes(PLACEHOLDER_MARKER);
}

const AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

/**
 * 認可の画面を開くURL。`state` と `nonce` は、どちらも `hashedNonce`（`SHA-256(T)`）。`scope` は付けない。
 * `hashedNonce` は URL の安全な文字（base64url）だけだが、念のためエンコードする。
 */
export function buildAuthorizeUrl(hashedNonce: string, config: AppleWebConfig = APPLE_WEB_CONFIG): string {
  const query = [
    ['client_id', config.servicesId],
    ['redirect_uri', config.callbackUrl],
    ['response_type', 'code'],
    ['response_mode', 'query'],
    ['state', hashedNonce],
    ['nonce', hashedNonce],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${AUTHORIZE_URL}?${query}`;
}

export interface ReturnParams {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * アプリに渡されたURLが、Appleからの戻り（`warikan-seikatsu://auth/apple?...`）なら、その `code`・`state`・`error` を返す。
 * 違うURLなら `null`。React Native の `URL` は完全ではないので、自前で読む。同じ名前が複数あれば最初のもの。
 */
export function parseReturnUrl(url: string): ReturnParams | null {
  const rest = url.startsWith(APP_RETURN_URL) ? url.slice(APP_RETURN_URL.length) : null;
  // `warikan-seikatsu://auth/apple` の直後は、終わり・`?`・`#`、または末尾の `/` だけ（`.../applesauce` などは別のURL）。
  if (rest === null || !/^\/?(?:[?#][\s\S]*)?$/.test(rest)) return null;
  const queryStart = rest.indexOf('?');
  const query = queryStart < 0 ? '' : rest.slice(queryStart + 1).split('#')[0] ?? '';
  const params: ReturnParams = {};
  for (const pair of query.split('&')) {
    const equals = pair.indexOf('=');
    if (equals <= 0) continue;
    const key = pair.slice(0, equals);
    if (key !== 'code' && key !== 'state' && key !== 'error') continue;
    if (params[key] !== undefined) continue;
    try {
      params[key] = decodeURIComponent(pair.slice(equals + 1).replace(/\+/g, ' '));
    } catch {
      // 読めない値は、無いものとして扱う
    }
  }
  return params;
}

/**
 * `app/+native-intent.tsx` の `redirectSystemPath` の中身。アプリに渡されたURLを、expo-router に渡す前に直す。
 * Appleからの戻りのURLは、サインインの処理（Linking を直接受け取る）が使うもので、画面ではない。そのまま渡すと
 * 「画面が見つかりません」へ遷移するので、**起動中は `null`（遷移しない）**、**起動時のURLなら `'/'`**（ルートから始める）を返す。
 * 起動時に `null` を返してはいけない: expo-router は、ディープリンクが無い起動を、ルートのURLに直して先頭の画面から
 * 始めるが、`null` はその処理を飛ばし、Stack の既定の先頭が開く（Singfolioで、Android で確認）。ほかのURLは、そのまま渡す。
 * 起動時の戻りのURL（Custom Tab を開いているあいだに、アプリのプロセスが終わったとき）は、`Linking` の `url` イベントでは
 * 届かないので、認可コードは受け取られない。`T`・`V` もメモリにしか無いので、拾わず、ログインをやり直してもらう。
 */
export function redirectSystemPath(path: string, initial: boolean): string | null {
  if (parseReturnUrl(path) === null) return path;
  return initial ? '/' : null;
}

/** ブラウザ・URLの受け取り・前面への復帰。実機では expo-web-browser・Linking・AppState（`platform/authBrowser.ts`）。 */
export interface AuthBrowser {
  /** URLをブラウザ（Custom Tab）で開く。開けたら解決する（ブラウザが閉じるのは待たない）。開けなければ失敗する。 */
  open(url: string): Promise<void>;
  /** アプリに渡されたURL（ディープリンク）を受け取る。戻り値は、受け取りをやめる関数。 */
  onUrl(listener: (url: string) => void): () => void;
  /** アプリが、いったん前面を離れたあと、前面に戻ったとき（ブラウザを閉じた・戻りのURLでアプリが開いた）。 */
  onForeground(listener: () => void): () => void;
}

export interface AuthCodeProviderLike {
  getAuthorizationCode(hashedNonce: string): Promise<string>;
}

// 前面に戻ってから、戻りのURLを待つ時間。戻りのURLでアプリが開くときは、前面への復帰とURLの到着の順番が
// 決まっていない（どちらが先でもよい）。この間にURLが来なければ、利用者がブラウザを閉じたと見る。
const FOREGROUND_GRACE_MS = 1500;
// 全体の上限。Workerの `T` の期限（5分）に合わせた値。`T` は待ち始める前に発行するので、`T` のほうが少し先に切れる
// （そのあとに戻りのURLが来ても、ログインは401になる）。過ぎたら、受け取りをやめる。
// サインインの層（`accountService`）も、これと別に、同じ5分の上限を持つ（`PROVIDER_TIMEOUT_MS`。層は、結果を待たずに捨てる）。
const WAIT_LIMIT_MS = 5 * 60_000;

export function createAppleWebSignInRepository(
  browser: AuthBrowser,
  options: { graceMs?: number; waitLimitMs?: number; config?: AppleWebConfig } = {},
): AuthCodeProviderLike {
  const graceMs = options.graceMs ?? FOREGROUND_GRACE_MS;
  const waitLimitMs = options.waitLimitMs ?? WAIT_LIMIT_MS;
  const config = options.config ?? APPLE_WEB_CONFIG;

  return {
    getAuthorizationCode(hashedNonce) {
      // 仮の値のままでは、Appleは認可の画面を出さない。開かずに断る（何も待たず、受け取りも始めない）。
      if (!isAppleWebConfigured(config)) return Promise.reject(new AuthError('provider-unavailable'));
      return new Promise<string>((resolve, reject) => {
        let settled = false;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const cleanups: Array<() => void> = [];

        const finish = (result: () => void) => {
          if (settled) return;
          settled = true;
          for (const cleanup of cleanups) cleanup();
          result();
        };
        const fail = (code: ConstructorParameters<typeof AuthError>[0]) => finish(() => reject(new AuthError(code)));

        // 受け取りは、ブラウザを開く前に始める（戻りのURLを取りこぼさない）。
        cleanups.push(
          browser.onUrl((url) => {
            const params = parseReturnUrl(url);
            if (params === null) return;
            // 自分のフローの `state` だけを受け取る。違う・無いものは、他のアプリが押し込んだものかもしれない。
            // 取りやめ（`error`）は、`state` が付かない場合に備えて、無くてもよい（違うものは受け取らない。Appleが
            // 取りやめに `state` を付けるかは、本物のAppleで確かめる。docs/backend-design.md 13章の9）。`state` の無い `error` の
            // URLは、外から送って、進行中のサインインを取りやめさせられる。それでも `state` を必須にしないのは、アプリを
            // 前面に出すだけで（ランチャーなど）、同じ取りやめが、猶予のあとに起きるため（Singfolioのエミュレータで確認）。
            // 守れる範囲が増えない。
            if (params.state !== undefined && params.state !== hashedNonce) return;
            if (params.error !== undefined) {
              fail(params.error === 'user_cancelled_authorize' ? 'cancelled' : 'provider-failed');
              return;
            }
            if (params.code !== undefined && params.state === hashedNonce && params.code !== '') {
              const { code } = params;
              finish(() => resolve(code));
            }
          }),
        );
        cleanups.push(
          browser.onForeground(() => {
            // 戻りのURLが先に来ていれば、すでに終わっている。まだなら、猶予のあいだ待つ。
            graceTimer ??= setTimeout(() => fail('cancelled'), graceMs);
          }),
        );
        const limitTimer = setTimeout(() => fail('timeout'), waitLimitMs);
        cleanups.push(() => {
          clearTimeout(limitTimer);
          if (graceTimer !== undefined) clearTimeout(graceTimer);
        });

        // 開けなかった（ブラウザが無い、など）。原因を言い切らない。
        browser.open(buildAuthorizeUrl(hashedNonce, config)).catch(() => fail('provider-failed'));
      });
    },
  };
}
