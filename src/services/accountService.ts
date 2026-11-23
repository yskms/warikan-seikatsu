// アカウント（ログイン・ログアウト・削除）のサインインの層。HTTP（`authRepository`）、セッションの保存
// （`sessionRepository`）、各社のサインイン（Apple・Google）をつなぐ。画面は、これだけを使う。
// Singfolio（src/services/accountService.ts）からのコピーを元にした（コピー元: singfolio 99f5970）。Singfolio側を直したときは、
// 差分を手で取り込む（名前・構造は、取り込めるよう保つ）。
//
// このアプリで変えたところ:
// - **ローカルDBの識別子（`localDataId`）を持たない**（端末にローカルDBが無い。`sessionRepository.ts` の先頭のコメント）。
//   代わりに、**再インストールのあと、前のセッションを捨てる**（`InstallMarker`。下の「再インストール」）。
// - `signOutOthers` を持たない（Workerに `/auth/logout-others` が無い。`authRepository.ts` の先頭のコメント）。
// - サインインを組み込まない（`deps` が `null`）ビルドを持たない（`available`・`null` の入口を外した）。ログインは必須で、
//   層は常にある。
// - **セッションの保存先を読めない（`unreadable`）ことを、「サインインしていない」と同じに扱わない**
//   （docs/backend-design.md 12章の「層を作るときに守ること」の②）。iOSの `WHEN_UNLOCKED_THIS_DEVICE_ONLY` は、端末が
//   ロック中だと読めない。`getSignedInProvider`・`deleteAccount`・`access.withSession` は、`unreadable` のとき
//   `AuthError('storage-failed')` を投げる（`null`・`not-signed-in` にしない）。画面は、これを「分からない」として扱い、
//   すぐにログイン画面へ送らず、読み直す。`signIn` は、`unreadable` でも進めて上書きする（壊れた値が残る端末が、
//   二度とサインインできなくなるため。ユーザーの操作でしか呼ばれないので、ロック中の一時的な失敗では起きない）。
//   `signOut` は、`unreadable` のとき端末の値を消し、失効を確認できたとは言わない（`serverRevoked: false`）。
// - `createServices` を持たない。組み立ては `platform/` が、依存（`AccountServiceDeps`）を渡して行う。
//
// 再インストール（iOS）: Keychainは、アプリを削除しても残りうる（Androidは消える）。「アプリを消したらログアウトされる」
// という期待に合わせるため、アプリの削除で消える保存先に置いた印（`InstallMarker`）が無い起動では、Keychainのセッションを
// 捨てる。印を**先に**置き、そのあとでセッションを捨てる（印を置けなければ、何も捨てない）。順序を逆にして、印を置くのに
// 失敗し続けると、起動のたびにログアウトされる。捨てられなかったとき（ロック中など）は、そのまま（前のセッションが
// 生きたままになる。許すのと同じ状態に戻るだけ）。捨てたセッションは、サーバーでも失効させる（失敗は無視。待たない）。
// **印は、最初のリリースから置いておくこと**（印の無い版から入れた利用者は、印を足した版の最初の起動でログアウトされる）。
import type { AuthProvider } from '../domain/types.ts';
import { AuthError } from '../repositories/authError.ts';
import type { AuthRepository, DeleteAccountRequest } from '../repositories/authRepository.ts';
import type { SessionRead, SessionRepository, StoredSession } from '../repositories/sessionRepository.ts';

/**
 * 各社のサインイン（Apple・Google）。SDKの呼び出しとレスポンスの形はここに閉じ込める（各社のRepositoryが
 * 実装する）。画面・層は触れない。
 */
export interface IdTokenProvider {
  /**
   * 各社のサインインを開き、IDトークンの全文を返す。`hashedNonce` は、IDトークンの `nonce` に入れる値
   * （`SHA-256(T)` の base64url）。利用者が取りやめたら `AuthError('cancelled')`、それ以外の失敗も
   * `AuthError`（トークン・応答の内容は載せない）。
   */
  getIdToken(hashedNonce: string): Promise<string>;
  /**
   * アカウントの削除の再認証用。`getIdToken` と同じサインインで、IDトークンと、Appleのトークンを失効させるための認可コードも
   * 返す。Apple（iOS）だけが持つ（無ければ、`getIdToken` で代える。認可コードが無いので、Appleのトークンは失効できない）。
   * 失敗・取りやめは `getIdToken` と同じ。
   */
  getIdTokenWithCode?(hashedNonce: string): Promise<{ idToken: string; authorizationCode?: string }>;
}

/**
 * 各社のサインインのうち、IDトークンではなく**認可コード**を返すもの（AndroidのAppleログイン。Web経由）。
 * IDトークンへの交換は、Workerがする（`client_secret` を持つため）。画面・層は、ブラウザ・URLの扱いに触れない。
 */
export interface AuthCodeProvider {
  /**
   * 各社の認可の画面を開き、認可コードを返す。`hashedNonce` は、認可リクエストの `state` と `nonce` に入れる値
   * （`SHA-256(T)` の base64url）。利用者が取りやめたら `AuthError('cancelled')`、それ以外の失敗も `AuthError`
   * （コード・`state` の値は載せない）。
   */
  getAuthorizationCode(hashedNonce: string): Promise<string>;
}

/**
 * 「このインストールで、アプリを一度起動した」印。**アプリの削除で消える保存先**（Keychainの外。実体は `platform/installMarker.ts`）に
 * 置く。印が無い起動は、インストール（再インストール）の直後とみなす。
 */
export interface InstallMarker {
  /** 印があるか。読めなければ投げる（層は、何も捨てずに進める）。 */
  exists(): Promise<boolean>;
  /** 印を置く。置けなければ投げる（層は、何も捨てずに進める）。 */
  set(): Promise<void>;
}

export interface AccountServiceDeps {
  auth: AuthRepository;
  sessions: SessionRepository;
  /** 再インストールの検出（上の説明）。 */
  installMarker: InstallMarker;
  /** 文字列（UTF-8）の SHA-256 を base64url（パディングなし。43字）にする。 */
  sha256Base64Url(text: string): Promise<string>;
  /** 組み込み済みのサインイン。無いものは `signIn` が `provider-unavailable` にする。 */
  idTokenProviders: Partial<Record<AuthProvider, IdTokenProvider>>;
  /**
   * 組み込み済みの、認可コードを返すサインイン（AndroidのApple）。同じ手段が `idTokenProviders` にもあれば、
   * そちらを使う（OSごとに、どちらか1つだけを組み込む）。
   */
  authCodeProviders?: Partial<Record<AuthProvider, AuthCodeProvider>>;
  /**
   * 検証用の値 `V`（乱数の base64url。43字）を作る。認可コードの経路で、`T` に結びつける。`V` は、その `SHA-256` を
   * `T` に入れてWorkerへ渡し、コードと一緒にWorkerへ送るまで、アプリの外に出さない。
   */
  randomVerifier?: () => string;
  /** 各社のサインインを待つ上限（ミリ秒）。既定は `PROVIDER_TIMEOUT_MS`。テスト用 */
  providerTimeoutMs?: number;
}

/**
 * 各社のサインイン（OSの画面）を待つ上限。Workerが発行する `T` の期限（発行から5分。docs/backend-design.md 9章の「認証API」）と
 * 同じにしてある: これを過ぎて返ったIDトークンは、`T` が切れていて、どのみち 401 になる。
 *
 * 待つのをやめるだけで、OSの画面は閉じられない（Apple・Googleのどちらの SDK にも、画面を取り消す手段が無い）。
 * 上限が要るのは、結果が返らないと、直列化（下）のせいで後ろのログアウトも待ち続けるため。
 */
export const PROVIDER_TIMEOUT_MS = 5 * 60_000;

export interface SignOutResult {
  /**
   * サーバー側のセッションの失効まで確認できたか。`false` は、通信できなかった・サーバーが使えなかった、
   * または端末の値を読めず、失効させるものを特定できなかった（端末の値は、どの場合も消してある）。サーバーに
   * 残ったセッションは、最後の利用から90日で切れる。値を持つ端末が無いので使われない。
   * 端末に値が無かったときは、失効させるものが無いので `true`。
   */
  serverRevoked: boolean;
}

export interface DeleteAccountResult {
  /**
   * 端末のセッションを捨てられたか。`false` は、削除は成功したが、端末の値を消せなかった（残った値は、次に認証が要る
   * 呼び出しをしたとき 401 になり、そこで捨てる）。画面は、「削除したが、この端末はまだサインイン中」と伝え、
   * ログアウトを案内する（ログアウトは端末の値を捨てる）。
   */
  sessionCleared: boolean;
  /**
   * Appleのトークンを失効できたか。Googleは `null`（失効するものが無い）。`false` でも、アカウントは消えている
   * （失効に失敗しても、削除は止めない）。利用者には、Appleの設定（Apple Account の「Appleでサインイン」）から、
   * このアプリとの連携を解除できると案内できる。
   */
  appleRevoked: boolean | null;
}

export interface AccountService {
  /**
   * サインイン中のログイン手段。していなければ `null`。セッションの値は渡さない。**端末の保存先を読めなかった
   * （`unreadable`）ときは、`null` にせず `AuthError('storage-failed')`**（「ログアウト中」と「分からない」を画面が
   * 取り違えないため。端末がロック中の一時的な失敗かもしれない）。画面は、これを捕まえて「分からない」として扱い、
   * すぐにログイン画面へ送らない。そのほかの失敗は `unexpected`。
   */
  getSignedInProvider(): Promise<AuthProvider | null>;
  /**
   * サインインする。失敗・取りやめは、すべて `AuthError`（想定外の失敗は `unexpected`）。サインイン済みなら
   * `already-signed-in`。保存先を読めない値が残っていても、進めて上書きする。
   */
  signIn(provider: AuthProvider): Promise<void>;
  /**
   * ログアウトする。端末の値は必ず捨てる（捨てられなければ `storage-failed`）。失敗は `AuthError`。
   */
  signOut(): Promise<SignOutResult>;
  /**
   * アカウントを削除する。サインイン中にだけできる（していなければ `not-signed-in`。保存先を読めなければ
   * `storage-failed`）。**再認証を挟む**: ログインと同じ手段のサインインの画面が出る（取りやめは `cancelled`。何も消えない）。
   * 再認証のアカウントが、ログイン中のものと違えば `account-mismatch`、通らなければ `reauth-failed`（どちらも、何も消えず、
   * サインインは保たれる）。成功したら、端末のセッションを捨てる。サーバーがこのセッションを認めなければ（`unauthorized`）、
   * 端末のセッションを捨てる。失敗は `AuthError`。削除の要求（`/auth/delete`）を送ったあとの通信の失敗は
   * `delete-unconfirmed`（サーバーで削除が済んでいるかもしれない。応答が読めない `invalid-response` も含む）。
   * それより前（`T` の取得）の通信の失敗は、何も消えていないので、ふつうの `network`。
   *
   * **`unavailable`（429・5xx）と、`/auth/delete` の 500・503 は、どれも、何も消えていない**（docs/backend-design.md 9章の
   * 「アプリが守ること（delete）」）。画面は、再認証（新しい `T`）からやり直させる。`unauthorized` のときだけ、端末のセッションを
   * 捨てる（この層がやる）。
   */
  deleteAccount(): Promise<DeleteAccountResult>;
}

/**
 * 認証が要るサーバーの呼び出しの入口。**API（グループ・支出など）を呼ぶ層だけが使う。** `AccountService`（画面が使う型）には
 * 含めない: セッションの値を画面に渡さない。
 */
export interface SessionAccess {
  /**
   * サインイン中のセッションで `task` を実行する。していなければ `not-signed-in`、保存先を読めなければ `storage-failed`。
   * サーバーが認めなかったとき（`task` が `AuthError('unauthorized')` を投げたとき）だけ、端末のセッションを捨てる
   * （503・5xx・通信の失敗では捨てない）。`task` の失敗は、そのまま投げる（`AuthError` に包まない）。
   * サインイン・ログアウトとは直列にしない（APIの通信を、各社のサインインの待ちに巻き込まない）。
   */
  withSession<T>(task: (session: string) => Promise<T>): Promise<T>;
}

/**
 * `createAccountService` の戻り値。`access` はAPIを呼ぶ層へ渡し、残り（`AccountService`）が画面へ届く（組み立てる側が
 * `access` を取り除く）。
 */
export type AccountServiceWithAccess = AccountService & { readonly access: SessionAccess };

/**
 * アカウント（ログイン・ログアウト・削除）。
 */
export function createAccountService(deps: AccountServiceDeps): AccountServiceWithAccess {
  const { auth, sessions, installMarker, sha256Base64Url, idTokenProviders } = deps;
  const authCodeProviders = deps.authCodeProviders ?? {};
  const providerTimeoutMs = deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;

  // サインインとログアウトは1本ずつ順に実行する。サインインの途中（各社の画面を開いている間）に
  // ログアウトが走ると、ログアウトの後にセッションが保存されて、ログアウトできていないことになる。
  // 各社のサインインが終わらないと後ろのログアウトも待つので、その待ちには上限を置く
  // （`PROVIDER_TIMEOUT_MS`）。画面を取り消す手段は無く、サインイン中に呼べるログアウトの入口も無い
  // （OSの画面が、アプリの操作を止めている）ので、取り消しの口は作らない。
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  }

  /**
   * `task` の結果を、`ms` 待つ。過ぎたら `timeout` で返す。`task` は止められないので動いたままで、あとで
   * 返った結果・失敗は捨てる（どちらも受け取る側を付けてあるので、未処理の拒否にはならない）。
   */
  function withTimeout<T>(task: () => Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AuthError('timeout')), ms);
      new Promise<T>((run) => run(task())).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // 呼び出し側（画面）が `code` で分類できるよう、`AuthError` 以外の失敗は `unexpected` に包む。元の例外は
  // 載せない（各社のSDKの例外に、トークンなどが入りうる）。
  async function asAuthError<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      throw error instanceof AuthError ? error : new AuthError('unexpected');
    }
  }

  /** サーバー側のセッションを失効させる。失敗は無視する（呼び出し側は、結果に依らず進める）。 */
  async function revokeQuietly(session: string): Promise<void> {
    try {
      await auth.logout(session);
    } catch {
      // 失効できなくても、サーバーのセッションは最後の利用から90日で切れる
    }
  }

  // 再インストールの検出（先頭の説明）。セッションを読む入口は、すべて、先にこれを待つ（捨て終わる前に、前のセッションを
  // 読まないため）。1回だけ実行し、失敗しても投げない（起動を止めない）。
  let installChecked: Promise<void> | null = null;
  function ensureInstallChecked(): Promise<void> {
    installChecked ??= (async () => {
      try {
        if (await installMarker.exists()) return;
        // 印を先に置く。置けなければ、何も捨てない（捨ててから、印を置けないまま、毎回捨てることにならないため）。
        await installMarker.set();
      } catch {
        return;
      }
      try {
        const read = await sessions.read();
        // 読めない値も捨てる（再インストール前の残りかもしれない。読めないままでは、失効させるものを特定できない）。
        if (read.kind === 'none') return;
        await sessions.clear();
        // 待たない（起動を、通信の待ちに巻き込まない）。失敗は `revokeQuietly` が握りつぶす。
        if (read.kind === 'found') void revokeQuietly(read.value.session);
      } catch {
        // 捨てられなかった（端末がロック中など）。前のセッションが残るだけで、許すのと同じ状態。
      }
    })();
    return installChecked;
  }

  /** 保存済みのセッション。再インストールの検出を済ませてから読む。 */
  async function readSession(): Promise<SessionRead> {
    await ensureInstallChecked();
    return sessions.read();
  }

  /** サインイン中のセッション。していなければ `null`、保存先を読めなければ `storage-failed`。 */
  async function currentSession(): Promise<StoredSession | null> {
    const read = await readSession();
    if (read.kind === 'none') return null;
    if (read.kind === 'unreadable') throw new AuthError('storage-failed');
    return read.value;
  }

  /** サインイン中のセッション。していなければ `not-signed-in`、保存先を読めなければ `storage-failed`。 */
  async function requireSession(): Promise<StoredSession> {
    const current = await currentSession();
    if (!current) throw new AuthError('not-signed-in');
    return current;
  }

  /**
   * 認証が要るサーバーの呼び出し。サーバーが認めなかったとき（401）だけ、端末のセッションを捨てる（認めない値は二度と
   * 通らない）。503・5xx・通信の失敗では捨てない（一時的な失敗。セッションは生きている）。捨てられなくても、失敗は
   * `unauthorized` のまま（次の呼び出しも 401 になり、また捨てようとする）。
   */
  async function authorized<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof AuthError && error.code === 'unauthorized') {
        try {
          await sessions.clear();
        } catch {
          // 捨てられなかった。呼び出し側へは、元の失敗を返す
        }
      }
      throw error;
    }
  }

  return {
    getSignedInProvider() {
      return asAuthError(async () => (await currentSession())?.provider ?? null);
    },

    signIn(provider) {
      return serialize(() =>
        asAuthError(async () => {
          const idTokenProvider = idTokenProviders[provider];
          const authCodeProvider = idTokenProvider ? undefined : authCodeProviders[provider];
          if (!idTokenProvider && !authCodeProvider) throw new AuthError('provider-unavailable');
          // 読めない値が残っていても、サインインは進める（上書きする）。読めないだけで止めると、壊れた値が残る端末は、
          // 二度とサインインできない。読めない値は、失効させるものを特定できず、サーバーに残る（最後の利用から90日で
          // 切れる。ログアウトで失効を確認できない場合と同じ）。
          if ((await readSession()).kind === 'found') throw new AuthError('already-signed-in');

          let session: string;
          if (idTokenProvider) {
            // nonce の元 `T` を得て、そのハッシュを各社のサインインに渡す（リプレイ対策）。
            // `T` は5分で切れるので、各社の画面を開いたまま放置すると、ログインは 401 になる（やり直す）。
            const nonce = await auth.requestNonce();
            const hashedNonce = await sha256Base64Url(nonce);
            const idToken = await withTimeout(
              () => idTokenProvider.getIdToken(hashedNonce),
              providerTimeoutMs,
            );
            if (typeof idToken !== 'string' || idToken === '') throw new AuthError('invalid-response');
            session = await auth.login({ provider, idToken, nonce });
          } else {
            // 認可コードの経路（AndroidのApple）。検証用の値 `V` を作り、そのハッシュ `C` を入れた `web` の `T` を得る。
            // 横取りされた `code` と `state`（`state` は `T` のハッシュ）だけでは、`T` も `V` も無いので、Workerは受け付けない。
            if (!authCodeProvider || provider !== 'apple') throw new AuthError('provider-unavailable');
            const verifier = deps.randomVerifier?.();
            if (typeof verifier !== 'string' || verifier === '') throw new AuthError('unexpected');
            const nonce = await auth.requestWebNonce(await sha256Base64Url(verifier));
            const hashedNonce = await sha256Base64Url(nonce);
            const code = await withTimeout(
              () => authCodeProvider.getAuthorizationCode(hashedNonce),
              providerTimeoutMs,
            );
            if (typeof code !== 'string' || code === '') throw new AuthError('invalid-response');
            session = await auth.loginWithAppleCode({ code, nonce, verifier });
          }

          try {
            await sessions.set({ session, provider });
          } catch {
            // 保存できないと、端末はこのセッションを二度と使えない。サーバーに残さない（失敗は無視）。
            await revokeQuietly(session);
            throw new AuthError('storage-failed');
          }
        }),
      );
    },

    signOut() {
      return serialize(() =>
        asAuthError(async () => {
          const read = await readSession();
          // 端末の値を先に捨てる。サーバーへの要求の途中でアプリが終わっても、端末はログアウトした状態に
          // なる。捨てられなければ（読み戻しで残っていた場合を含む）、ここで止める（ログアウトできて
          // いないことを、成功に見せない。サーバーへも送らない）。読めなかったときも消す。
          try {
            await sessions.clear();
          } catch {
            throw new AuthError('storage-failed');
          }
          if (read.kind === 'none') return { serverRevoked: true };
          // 値が残っているかもしれないが、読めず、失効させるものを特定できない。
          if (read.kind === 'unreadable') return { serverRevoked: false };
          try {
            await auth.logout(read.value.session);
          } catch (error) {
            // 401 はヘッダーの形が違うときだけ（失効するものが無い）。それ以外は、確認できなかった。
            if (!(error instanceof AuthError && error.code === 'unauthorized')) {
              return { serverRevoked: false };
            }
          }
          return { serverRevoked: true };
        }),
      );
    },

    deleteAccount() {
      return serialize(() =>
        asAuthError(async () => {
          const current = await requireSession();
          const { provider } = current;
          const idTokenProvider = idTokenProviders[provider];
          const authCodeProvider = idTokenProvider ? undefined : authCodeProviders[provider];
          if (!idTokenProvider && !authCodeProvider) throw new AuthError('provider-unavailable');

          // 再認証。ログインと同じ手順で、`T` を得て、各社のサインインを開く（`signIn` と同じ時間の上限）。
          let request: DeleteAccountRequest;
          if (idTokenProvider) {
            const nonce = await auth.requestNonce();
            const hashedNonce = await sha256Base64Url(nonce);
            if (provider === 'apple') {
              const credential = await withTimeout(
                async (): Promise<{ idToken: string; authorizationCode?: string }> =>
                  idTokenProvider.getIdTokenWithCode
                    ? idTokenProvider.getIdTokenWithCode(hashedNonce)
                    : { idToken: await idTokenProvider.getIdToken(hashedNonce) },
                providerTimeoutMs,
              );
              if (typeof credential.idToken !== 'string' || credential.idToken === '') throw new AuthError('invalid-response');
              request = {
                provider: 'apple',
                nonce,
                idToken: credential.idToken,
                ...(typeof credential.authorizationCode === 'string' && credential.authorizationCode !== ''
                  ? { authorizationCode: credential.authorizationCode }
                  : {}),
              };
            } else {
              const idToken = await withTimeout(() => idTokenProvider.getIdToken(hashedNonce), providerTimeoutMs);
              if (typeof idToken !== 'string' || idToken === '') throw new AuthError('invalid-response');
              request = { provider: 'google', nonce, idToken };
            }
          } else {
            if (!authCodeProvider || provider !== 'apple') throw new AuthError('provider-unavailable');
            const verifier = deps.randomVerifier?.();
            if (typeof verifier !== 'string' || verifier === '') throw new AuthError('unexpected');
            const nonce = await auth.requestWebNonce(await sha256Base64Url(verifier));
            const hashedNonce = await sha256Base64Url(nonce);
            const code = await withTimeout(() => authCodeProvider.getAuthorizationCode(hashedNonce), providerTimeoutMs);
            if (typeof code !== 'string' || code === '') throw new AuthError('invalid-response');
            request = { provider: 'apple', nonce, code, verifier };
          }

          // 要求を送ったあとの通信の失敗は、結果が分からない（サーバーで済んでいるかもしれない）。送る前の失敗
          // （上の `T` の取得）と区別して、画面が、それぞれの文言を出せるようにする。
          // `invalid-response`（200 なのに本文が読めない・形が違う）も同じ: Workerが 200 を返すのは、D1を消したあとなので、
          // サーバーでは済んでいる。`unavailable`（5xx・429）は読み替えない: WorkerのIDトークンの検証・Appleの呼び出しが
          // 使えないときの 503 は、すべてD1を消す前で、何も消えていない（消したあとの失効の失敗は握りつぶして 200 を返す）。
          const result = await authorized(async () => {
            try {
              return await auth.deleteAccount(current.session, request);
            } catch (error) {
              if (error instanceof AuthError && (error.code === 'network' || error.code === 'invalid-response')) {
                throw new AuthError('delete-unconfirmed');
              }
              throw error;
            }
          });
          // アカウントは消えた。端末のセッションは、もう使えないので捨てる。捨てられなくても、削除は成功のまま
          // （残った値は、次に認証が要る呼び出しをしたとき 401 になり、そこで捨てる）。画面には `sessionCleared` で伝える。
          let sessionCleared = true;
          try {
            await sessions.clear();
          } catch {
            sessionCleared = false;
          }
          return { appleRevoked: result.appleRevoked, sessionCleared };
        }),
      );
    },

    access: {
      async withSession<T>(task: (session: string) => Promise<T>): Promise<T> {
        // セッションを読めない失敗は、`AuthError` に包む（`task` の失敗は包まない）。
        const current = await asAuthError(requireSession);
        return authorized(() => task(current.session));
      },
    },
  };
}
