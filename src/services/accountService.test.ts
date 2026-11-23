// アカウント（ログイン・ログアウト・削除）のサインインの層のテスト。`npm test` で実行する。HTTP・SecureStore・各社の
// サインイン・再インストールの印は偽物（実機のサインインでの確認は docs/backend-design.md 13章の9）。
// Singfolio（src/services/accountService.test.ts）を元にした（コピー元: singfolio 99f5970）。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import type { AuthProvider } from '../domain/types.ts';
import { AuthError } from '../repositories/authError.ts';
import type { AuthRepository } from '../repositories/authRepository.ts';
import { createSessionRepository, type SecureStorage } from '../repositories/sessionRepository.ts';
import {
  createAccountService,
  type AuthCodeProvider,
  type IdTokenProvider,
  type InstallMarker,
} from './accountService.ts';

const sha256Base64Url = async (text: string) =>
  createHash('sha256').update(text).digest('base64url');

/** 印がある（このインストールで、すでに一度起動した）状態の、偽の `InstallMarker`。 */
function installedMarker(): InstallMarker {
  return { exists: async () => true, set: async () => {} };
}

/** 印が無い（インストール直後の最初の起動）状態の、偽の `InstallMarker`。`set` が呼ばれると、印がある状態になる。 */
function freshMarker() {
  const state = { present: false, sets: 0 };
  const marker: InstallMarker = {
    exists: async () => state.present,
    set: async () => {
      state.sets += 1;
      state.present = true;
    },
  };
  return { marker, state };
}

function memoryStorage() {
  const items = new Map<string, string>();
  const storage: SecureStorage = {
    getItemAsync: async (key) => items.get(key) ?? null,
    setItemAsync: async (key, value) => void items.set(key, value),
    deleteItemAsync: async (key) => void items.delete(key),
  };
  return { storage, items };
}

/** 呼ばれた順の記録つきの、偽のHTTP。 */
function fakeAuth(overrides: Partial<AuthRepository> = {}) {
  const calls: string[] = [];
  const auth: AuthRepository = {
    requestNonce: async () => {
      calls.push('nonce');
      return 'T-1';
    },
    requestWebNonce: async (challenge) => {
      calls.push(`web-nonce:${challenge}`);
      return 'T-WEB-1';
    },
    login: async ({ provider, idToken, nonce }) => {
      calls.push(`login:${provider}:${idToken}:${nonce}`);
      return 'SESSION-1';
    },
    loginWithAppleCode: async ({ code, nonce, verifier }) => {
      calls.push(`apple-code-login:${code}:${nonce}:${verifier}`);
      return 'SESSION-WEB-1';
    },
    logout: async (session) => {
      calls.push(`logout:${session}`);
    },
    deleteAccount: async (session, request) => {
      calls.push(`delete:${session}:${JSON.stringify(request)}`);
      return { appleRevoked: true };
    },
    ...overrides,
  };
  return { auth, calls };
}

function setup(
  options: {
    auth?: Partial<AuthRepository>;
    providers?: Partial<Record<AuthProvider, IdTokenProvider>>;
    codeProviders?: Partial<Record<AuthProvider, AuthCodeProvider>>;
    randomVerifier?: () => string;
    sha256?: (text: string) => Promise<string>;
    providerTimeoutMs?: number;
    installMarker?: InstallMarker;
  } = {},
) {
  const { storage, items } = memoryStorage();
  const sessions = createSessionRepository(storage);
  const { auth, calls } = fakeAuth(options.auth);
  const hashed: string[] = [];
  const apple: IdTokenProvider = {
    getIdToken: async (hashedNonce) => {
      hashed.push(hashedNonce);
      calls.push('apple-sheet');
      return 'ID-TOKEN';
    },
  };
  const account = createAccountService({
    auth,
    sessions,
    sha256Base64Url: options.sha256 ?? sha256Base64Url,
    installMarker: options.installMarker ?? installedMarker(),
    idTokenProviders: options.providers ?? { apple },
    authCodeProviders: options.codeProviders,
    randomVerifier: options.randomVerifier ?? (() => 'V'.repeat(43)),
    providerTimeoutMs: options.providerTimeoutMs,
  });
  return { account, sessions, items, calls, hashed };
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof AuthError && error.code === code);
}

describe('signIn', () => {
  it('T を得て、そのハッシュを各社に渡し、IDトークンと T でログインして、セッションを保存する', async () => {
    const { account, sessions, calls, hashed } = setup();
    assert.equal(await account.getSignedInProvider(), null);
    await account.signIn('apple');
    assert.deepEqual(calls, ['nonce', 'apple-sheet', 'login:apple:ID-TOKEN:T-1']);
    // 各社に渡すのは T そのものではなく SHA-256(T) の base64url（43字）
    assert.deepEqual(hashed, [createHash('sha256').update('T-1').digest('base64url')]);
    assert.equal(hashed[0].length, 43);
    assert.deepEqual(await sessions.read(), {
      kind: 'found',
      value: { session: 'SESSION-1', provider: 'apple' },
    });
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('組み込まれていない手段は provider-unavailable。通信も保存もしない', async () => {
    const { account, calls, items } = setup();
    await rejectsWith(account.signIn('google'), 'provider-unavailable');
    assert.deepEqual(calls, []);
    assert.equal(items.size, 0);
  });

  it('サインイン済みなら already-signed-in。通信しない', async () => {
    const { account, calls } = setup();
    await account.signIn('apple');
    calls.length = 0;
    await rejectsWith(account.signIn('apple'), 'already-signed-in');
    assert.deepEqual(calls, []);
  });

  it('各社の画面を取りやめたら cancelled で、何も保存せず、login を呼ばない。T は使い切りにならない', async () => {
    const { account, calls, items } = setup({
      providers: {
        apple: {
          getIdToken: async () => {
            throw new AuthError('cancelled');
          },
        },
      },
    });
    await rejectsWith(account.signIn('apple'), 'cancelled');
    assert.deepEqual(calls, ['nonce']);
    assert.equal(items.size, 0);
    assert.equal(await account.getSignedInProvider(), null); // やり直せる
  });

  it('IDトークンが空・文字列でなければ invalid-response（login を呼ばない）', async () => {
    for (const token of ['', undefined, 5]) {
      const { account, calls } = setup({
        providers: { apple: { getIdToken: async () => token as unknown as string } },
      });
      await rejectsWith(account.signIn('apple'), 'invalid-response');
      assert.deepEqual(calls, ['nonce']);
    }
  });

  it('nonce の取得・ログインの失敗は、そのまま投げて、何も保存しない', async () => {
    for (const code of ['network', 'unavailable', 'unauthorized'] as const) {
      const { account, items } = setup({
        auth: {
          login: async () => {
            throw new AuthError(code);
          },
        },
      });
      await rejectsWith(account.signIn('apple'), code);
      assert.equal(items.size, 0);
    }
    const { account, calls } = setup({
      auth: {
        requestNonce: async () => {
          throw new AuthError('network');
        },
      },
    });
    await rejectsWith(account.signIn('apple'), 'network');
    assert.deepEqual(calls, []); // 各社の画面を開かない
  });

  it('保存に失敗したら、サーバーのセッションを失効させて storage-failed', async () => {
    const calls: string[] = [];
    const account = createAccountService({
      auth: fakeAuth({
        logout: async (session) => {
          calls.push(`logout:${session}`);
          throw new AuthError('network'); // 失効の失敗は握りつぶす
        },
      }).auth,
      sessions: createSessionRepository({
        getItemAsync: async () => null,
        setItemAsync: async () => {
          throw new Error('disk full');
        },
        deleteItemAsync: async () => {},
      }),
      sha256Base64Url,
      installMarker: installedMarker(),
      idTokenProviders: { apple: { getIdToken: async () => 'ID-TOKEN' } },
    });
    await rejectsWith(account.signIn('apple'), 'storage-failed');
    assert.deepEqual(calls, ['logout:SESSION-1']);
  });

  it('読めない値が残っていても、サインインは進めて上書きする（読めないだけで止めると、二度と入れない）。失効はできない', async () => {
    const { account, items, calls } = setup();
    items.set('warikan-seikatsu.session', 'garbage');
    await account.signIn('apple');
    assert.equal(await account.getSignedInProvider(), 'apple');
    // 失効させるものを特定できない
    assert.deepEqual(calls, ['nonce', 'apple-sheet', 'login:apple:ID-TOKEN:T-1']);
  });
});

describe('signIn（認可コードの経路。AndroidのApple）', () => {
  const VERIFIER = 'V'.repeat(43);

  function setupWeb(codeProvider?: Partial<AuthCodeProvider>, options: Parameters<typeof setup>[0] = {}) {
    const codes: string[] = [];
    const provider: AuthCodeProvider = {
      getAuthorizationCode: async (hashedNonce) => {
        codes.push(hashedNonce);
        return 'AUTH-CODE';
      },
      ...codeProvider,
    };
    // Androidでは、AppleのIDトークンの経路は組み込まない（iOSのネイティブだけ）。
    return { ...setup({ providers: {}, codeProviders: { apple: provider }, ...options }), codes };
  }

  it('V を作り、C=SHA-256(V) を入れた web の T を得て、SHA-256(T) で認可の画面を開き、コード・T・V でログインする', async () => {
    const { account, sessions, calls, codes } = setupWeb();
    await account.signIn('apple');
    const challenge = createHash('sha256').update(VERIFIER).digest('base64url');
    assert.deepEqual(calls, [
      `web-nonce:${challenge}`,
      `apple-code-login:AUTH-CODE:T-WEB-1:${VERIFIER}`,
    ]);
    // 画面に渡すのは T そのものではなく SHA-256(T)（state・nonce に入る）
    assert.deepEqual(codes, [createHash('sha256').update('T-WEB-1').digest('base64url')]);
    assert.equal(codes[0].length, 43);
    assert.deepEqual(await sessions.read(), {
      kind: 'found',
      value: { session: 'SESSION-WEB-1', provider: 'apple' },
    });
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('native の T（requestNonce）は取らない。V は、画面にも、ログインの前の通信にも出さない（ログインのときだけ送る）', async () => {
    const { account, calls, codes } = setupWeb();
    await account.signIn('apple');
    assert.equal(calls.includes('nonce'), false);
    assert.equal(codes.some((value) => value.includes(VERIFIER)), false);
    // V そのものを送るのは、`loginWithAppleCode` だけ。C（ハッシュ）は、T を得るときに送る
    assert.equal(calls.filter((call) => call.includes(VERIFIER)).length, 1);
    assert.ok(calls.find((call) => call.includes(VERIFIER))?.startsWith('apple-code-login:'));
  });

  it('画面を取りやめたら cancelled。何も保存せず、ログインを呼ばない。やり直せる', async () => {
    const { account, calls, items } = setupWeb({
      getAuthorizationCode: async () => {
        throw new AuthError('cancelled');
      },
    });
    await rejectsWith(account.signIn('apple'), 'cancelled');
    assert.equal(calls.some((call) => call.startsWith('apple-code-login')), false);
    assert.equal(items.size, 0);
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('コードが空・文字列でなければ invalid-response（ログインを呼ばない）', async () => {
    for (const code of ['', undefined, 5]) {
      const { account, calls } = setupWeb({ getAuthorizationCode: async () => code as unknown as string });
      await rejectsWith(account.signIn('apple'), 'invalid-response');
      assert.equal(calls.some((call) => call.startsWith('apple-code-login')), false);
    }
  });

  it('各社の画面が終わらなければ、上限で timeout（あとから返ったコードは使わない）', async () => {
    const { account, calls } = setupWeb(
      { getAuthorizationCode: () => new Promise((resolve) => setTimeout(() => resolve('LATE-CODE'), 40)) },
      { providerTimeoutMs: 10 },
    );
    await rejectsWith(account.signIn('apple'), 'timeout');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.some((call) => call.startsWith('apple-code-login')), false);
  });

  it('Worker の失敗（401・503）は、そのまま AuthError で返る。何も保存しない', async () => {
    for (const code of ['unauthorized', 'unavailable', 'network'] as const) {
      const { account, items } = setupWeb(undefined, {
        auth: {
          loginWithAppleCode: async () => {
            throw new AuthError(code);
          },
        },
      });
      await rejectsWith(account.signIn('apple'), code);
      assert.equal(items.size, 0);
    }
  });

  it('保存できなければ storage-failed で、サーバー側のセッションを失効させる', async () => {
    const { account, calls, sessions } = setupWeb();
    sessions.set = async () => {
      throw new Error('keystore failed');
    };
    await rejectsWith(account.signIn('apple'), 'storage-failed');
    assert.ok(calls.includes('logout:SESSION-WEB-1'));
  });

  it('V が作れなければ unexpected（Appleの画面を開く前）。Google は IDトークンの経路のまま', async () => {
    const { account, calls, codes } = setupWeb(undefined, { randomVerifier: () => '' });
    await rejectsWith(account.signIn('apple'), 'unexpected');
    assert.deepEqual(codes, []);
    assert.deepEqual(calls, []);

    const google: IdTokenProvider = { getIdToken: async () => 'GOOGLE-ID-TOKEN' };
    const both = setup({ providers: { google }, codeProviders: { apple: { getAuthorizationCode: async () => 'c' } } });
    await both.account.signIn('google');
    assert.ok(both.calls.includes('login:google:GOOGLE-ID-TOKEN:T-1'));
  });

  it('同じ手段が IDトークンの経路にもあれば、そちらを使う（OSごとに、どちらか1つ）。どちらにも無ければ provider-unavailable', async () => {
    const both = setup({ codeProviders: { apple: { getAuthorizationCode: async () => 'c' } } });
    await both.account.signIn('apple');
    assert.ok(both.calls.includes('apple-sheet'));
    assert.equal(both.calls.some((call) => call.startsWith('web-nonce')), false);

    const none = setup({ providers: {}, codeProviders: {} });
    await rejectsWith(none.account.signIn('apple'), 'provider-unavailable');
    assert.deepEqual(none.calls, []);
  });
});

describe('失敗は AuthError に包む（画面が code で分類できる）', () => {
  it('ハッシュの計算の失敗は unexpected。保存も login もしない', async () => {
    const { account, calls, items } = setup({
      sha256: async () => {
        throw new Error('digest unavailable');
      },
    });
    await rejectsWith(account.signIn('apple'), 'unexpected');
    assert.deepEqual(calls, ['nonce']);
    assert.equal(items.size, 0);
  });

  it('各社のサインインが契約に反して投げた例外は unexpected。元の例外の内容（トークンなど）は載せない', async () => {
    const { account } = setup({
      providers: {
        apple: {
          getIdToken: async () => {
            throw new Error('SDK failed for token SECRET-TOKEN');
          },
        },
      },
    });
    await assert.rejects(account.signIn('apple'), (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, 'unexpected');
      assert.ok(!error.message.includes('SECRET-TOKEN'));
      return true;
    });
  });

  it('ログアウトで端末の値を消せなければ storage-failed。サーバーへは送らない。状態は変わらない', async () => {
    const calls: string[] = [];
    const { storage } = memoryStorage();
    const sessions = createSessionRepository({
      ...storage,
      deleteItemAsync: async () => {
        throw new Error('delete failed');
      },
    });
    await sessions.set({ session: 'SESSION-1', provider: 'apple' });
    const account = createAccountService({
      auth: fakeAuth({ logout: async (s) => void calls.push(s) }).auth,
      sessions,
      sha256Base64Url,
      installMarker: installedMarker(),
      idTokenProviders: {},
    });
    await rejectsWith(account.signOut(), 'storage-failed');
    assert.deepEqual(calls, []);
    assert.equal(await account.getSignedInProvider(), 'apple'); // 端末の状態と見た目が食い違わない
  });

  it('削除が黙って失敗して値が残る（iOS）ときも storage-failed（ログアウトできたことにしない）', async () => {
    const { storage } = memoryStorage();
    const sessions = createSessionRepository({ ...storage, deleteItemAsync: async () => {} });
    await sessions.set({ session: 'SESSION-1', provider: 'apple' });
    const account = createAccountService({
      auth: fakeAuth().auth,
      sessions,
      sha256Base64Url,
      installMarker: installedMarker(),
      idTokenProviders: {},
    });
    await rejectsWith(account.signOut(), 'storage-failed');
    assert.equal(await account.getSignedInProvider(), 'apple');
  });
});

describe('signOut', () => {
  it('端末の値を捨ててから、サーバーのセッションを失効させる', async () => {
    const order: string[] = [];
    const { storage, items } = memoryStorage();
    const sessions = createSessionRepository({
      ...storage,
      deleteItemAsync: async (key) => {
        order.push('clear');
        await storage.deleteItemAsync(key);
      },
    });
    await sessions.set({ session: 'SESSION-9', provider: 'google' });
    const account = createAccountService({
      auth: fakeAuth({
        logout: async (session) => {
          order.push(`logout:${session}:${items.size}`);
        },
      }).auth,
      sessions,
      sha256Base64Url,
      installMarker: installedMarker(),
      idTokenProviders: {},
    });
    assert.deepEqual(await account.signOut(), { serverRevoked: true });
    assert.deepEqual(order, ['clear', 'logout:SESSION-9:0']); // 要求の時点で、端末の値はもう無い
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('通信できない・サーバーが使えなくても、端末はログアウトする（serverRevoked: false）', async () => {
    for (const code of ['network', 'unavailable'] as const) {
      const { account, items } = setup({
        auth: {
          logout: async () => {
            throw new AuthError(code);
          },
        },
      });
      await account.signIn('apple');
      assert.deepEqual(await account.signOut(), { serverRevoked: false });
      assert.equal(items.size, 0);
      assert.equal(await account.getSignedInProvider(), null);
    }
  });

  it('401（失効するものが無い）は、失効できた扱い', async () => {
    const { account } = setup({
      auth: {
        logout: async () => {
          throw new AuthError('unauthorized');
        },
      },
    });
    await account.signIn('apple');
    assert.deepEqual(await account.signOut(), { serverRevoked: true });
  });

  it('サインインしていなければ、何も送らずに成功する', async () => {
    const { account, calls } = setup();
    assert.deepEqual(await account.signOut(), { serverRevoked: true });
    assert.deepEqual(calls, []);
  });

  it('読めない値が残っていたら、消すが、失効を確認できたとは言わない（serverRevoked: false）。サーバーへは送らない', async () => {
    const { account, items, calls } = setup();
    items.set('warikan-seikatsu.session', 'garbage');
    assert.deepEqual(await account.signOut(), { serverRevoked: false });
    assert.equal(items.size, 0);
    assert.deepEqual(calls, []);
  });

  it('端末の読み取りが一時的に失敗していたときも、serverRevoked: false（値があるかもしれない）', async () => {
    const calls: string[] = [];
    const items = new Map<string, string>([['warikan-seikatsu.session', 'x']]);
    let failReads = true;
    const account = createAccountService({
      auth: fakeAuth({ logout: async (s) => void calls.push(s) }).auth,
      sessions: createSessionRepository({
        getItemAsync: async (key) => {
          // 最初の読み取り（signOut の冒頭）だけ失敗し、消したあとの読み戻しは通る
          if (failReads) {
            failReads = false;
            throw new Error('keychain locked');
          }
          return items.get(key) ?? null;
        },
        setItemAsync: async () => {},
        deleteItemAsync: async (key) => void items.delete(key),
      }),
      sha256Base64Url,
      installMarker: installedMarker(),
      idTokenProviders: {},
    });
    assert.deepEqual(await account.signOut(), { serverRevoked: false });
    assert.equal(items.size, 0);
    assert.deepEqual(calls, []);
  });

});

describe('直列化', () => {
  it('サインインの途中（各社の画面を開いている間）のログアウトは、サインインの後に実行される', async () => {
    let finishSheet: (token: string) => void = () => {};
    const { account, items } = setup({
      providers: {
        apple: { getIdToken: () => new Promise<string>((resolve) => (finishSheet = resolve)) },
      },
    });
    const signingIn = account.signIn('apple');
    const signingOut = account.signOut();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(items.size, 0); // サインインはまだ終わっていない。ログアウトも待っている
    finishSheet('ID-TOKEN');
    await signingIn;
    assert.deepEqual(await signingOut, { serverRevoked: true });
    // ログアウトの後にセッションが残らない
    assert.equal(items.size, 0);
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('各社のサインインが返らなくても、上限で timeout になり、後ろのログアウトが進む（保存も login もしない）', async () => {
    const { account, calls, items } = setup({
      providerTimeoutMs: 20,
      providers: { apple: { getIdToken: () => new Promise<string>(() => {}) } },
    });
    const signingIn = account.signIn('apple');
    const signingOut = account.signOut();
    await rejectsWith(signingIn, 'timeout');
    assert.deepEqual(await signingOut, { serverRevoked: true });
    assert.deepEqual(calls, ['nonce']);
    assert.equal(items.size, 0);
    assert.equal(await account.getSignedInProvider(), null); // やり直せる
  });

  it('上限を過ぎてから返ったトークンは捨てる（login も保存もしない）。あとからの失敗も未処理の拒否にならない', async () => {
    let finish: (token: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const late = setup({
      providerTimeoutMs: 10,
      providers: { apple: { getIdToken: () => new Promise<string>((resolve) => (finish = resolve)) } },
    });
    await rejectsWith(late.account.signIn('apple'), 'timeout');
    finish('LATE-ID-TOKEN');
    const lateFailure = setup({
      providerTimeoutMs: 10,
      providers: {
        apple: {
          getIdToken: () => new Promise<string>((_resolve, reject) => (fail = reject)),
        },
      },
    });
    await rejectsWith(lateFailure.account.signIn('apple'), 'timeout');
    fail(new Error('after the timeout'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(late.calls, ['nonce']);
    assert.equal(late.items.size, 0);
    assert.equal(await late.account.getSignedInProvider(), null);
  });

  it('上限の前に返れば、タイマーを残さない（残ると、テストの実行が上限の分だけ終わらない）', async () => {
    const { account } = setup(); // 上限は既定の5分
    await account.signIn('apple');
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('前の操作が失敗しても、次の操作は実行される', async () => {
    const { account } = setup({
      auth: {
        requestNonce: async () => {
          throw new AuthError('network');
        },
      },
    });
    await rejectsWith(account.signIn('apple'), 'network');
    assert.deepEqual(await account.signOut(), { serverRevoked: true });
  });
});

describe('deleteAccount（アカウントの削除）', () => {
  const googleProvider: IdTokenProvider = { getIdToken: async () => 'GOOGLE-ID-TOKEN' };
  const appleWithCode: IdTokenProvider = {
    getIdToken: async () => 'ID-TOKEN',
    getIdTokenWithCode: async () => ({ idToken: 'ID-TOKEN', authorizationCode: 'AUTH-CODE' }),
  };
  const requestOf = (calls: string[]) => {
    const call = calls.find((value) => value.startsWith('delete:'));
    return call === undefined ? undefined : JSON.parse(call.slice(call.indexOf(':', 'delete:'.length) + 1));
  };

  it('Apple（iOS）: T を得て、そのハッシュで再認証し、IDトークンと認可コードを T と一緒に送る。成功したら端末のセッションを捨てる', async () => {
    const hashed: string[] = [];
    const provider: IdTokenProvider = {
      getIdToken: async () => 'unused',
      getIdTokenWithCode: async (hashedNonce) => {
        hashed.push(hashedNonce);
        return { idToken: 'ID-TOKEN', authorizationCode: 'AUTH-CODE' };
      },
    };
    const { account, calls, sessions } = setup({ providers: { apple: provider } });
    await account.signIn('apple');
    calls.length = 0;
    assert.deepEqual(await account.deleteAccount(), { appleRevoked: true, sessionCleared: true });
    assert.deepEqual(calls, [
      'nonce',
      `delete:SESSION-1:${JSON.stringify({ provider: 'apple', nonce: 'T-1', idToken: 'ID-TOKEN', authorizationCode: 'AUTH-CODE' })}`,
    ]);
    assert.deepEqual(hashed, [createHash('sha256').update('T-1').digest('base64url')]);
    assert.equal((await sessions.read()).kind, 'none');
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('Apple: getIdTokenWithCode が無ければ getIdToken で再認証する（認可コードは付かない）。コードが空なら付けない', async () => {
    const plain = setup();
    await plain.account.signIn('apple');
    plain.calls.length = 0;
    await plain.account.deleteAccount();
    assert.deepEqual(requestOf(plain.calls), { provider: 'apple', nonce: 'T-1', idToken: 'ID-TOKEN' });

    const empty = setup({
      providers: { apple: { getIdToken: async () => 'x', getIdTokenWithCode: async () => ({ idToken: 'ID-TOKEN', authorizationCode: '' }) } },
    });
    await empty.account.signIn('apple');
    empty.calls.length = 0;
    await empty.account.deleteAccount();
    assert.deepEqual(requestOf(empty.calls), { provider: 'apple', nonce: 'T-1', idToken: 'ID-TOKEN' });
  });

  it('Google: IDトークンで再認証する。appleRevoked は、サーバーの応答のまま（null）', async () => {
    const { account, calls } = setup({
      providers: { google: googleProvider },
      auth: {
        deleteAccount: async (session, request) => {
          calls.push(`delete:${session}:${JSON.stringify(request)}`);
          return { appleRevoked: null };
        },
      },
    });
    await account.signIn('google');
    calls.length = 0;
    assert.deepEqual(await account.deleteAccount(), { appleRevoked: null, sessionCleared: true });
    assert.deepEqual(requestOf(calls), { provider: 'google', nonce: 'T-1', idToken: 'GOOGLE-ID-TOKEN' });
  });

  it('Android の Apple（認可コードの経路）: V・web の T・認可コードで再認証する', async () => {
    const codes: string[] = [];
    const { account, calls, sessions } = setup({
      providers: {},
      codeProviders: {
        apple: {
          getAuthorizationCode: async (hashedNonce) => {
            codes.push(hashedNonce);
            return 'AUTH-CODE';
          },
        },
      },
    });
    await account.signIn('apple');
    calls.length = 0;
    await account.deleteAccount();
    const challenge = createHash('sha256').update('V'.repeat(43)).digest('base64url');
    assert.equal(calls[0], `web-nonce:${challenge}`);
    assert.deepEqual(requestOf(calls), { provider: 'apple', nonce: 'T-WEB-1', code: 'AUTH-CODE', verifier: 'V'.repeat(43) });
    // 認可の画面を開いた回数は、サインインと削除の2回。どちらも `SHA-256(T)` を渡す。
    assert.deepEqual(codes, Array(2).fill(createHash('sha256').update('T-WEB-1').digest('base64url')));
    assert.equal((await sessions.read()).kind, 'none');
  });

  it('appleRevoked が false でも成功（アカウントは消えている）。値はそのまま返す', async () => {
    const { account } = setup({ auth: { deleteAccount: async () => ({ appleRevoked: false }) } });
    await account.signIn('apple');
    assert.deepEqual(await account.deleteAccount(), { appleRevoked: false, sessionCleared: true });
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('サインインしていなければ not-signed-in。各社の画面を開かず、通信しない', async () => {
    const { account, calls, hashed } = setup();
    await rejectsWith(account.deleteAccount(), 'not-signed-in');
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  });

  it('保存先を読めなければ storage-failed（not-signed-in にしない）。各社の画面を開かず、通信しない', async () => {
    const { account, calls, hashed, items } = setup();
    items.set('warikan-seikatsu.session', 'garbage');
    await rejectsWith(account.deleteAccount(), 'storage-failed');
    assert.deepEqual(calls, []);
    assert.deepEqual(hashed, []);
  });

  it('再認証の画面を取りやめたら cancelled。何も消さず、サインインも保つ', async () => {
    const { account, calls, sessions } = setup({
      providers: {
        apple: {
          getIdToken: async () => {
            throw new AuthError('cancelled');
          },
        },
      },
    });
    // 取りやめる版では、サインインできないので、保存済みのセッションを直接置く。
    await sessions.set({ session: 'SESSION-X', provider: 'apple' });
    await rejectsWith(account.deleteAccount(), 'cancelled');
    assert.equal(calls.some((call) => call.startsWith('delete:')), false);
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('再認証の画面が終わらなければ、上限で timeout。サインインは保つ。あとから返った結果は使わない', async () => {
    const provider: IdTokenProvider = {
      getIdToken: () => new Promise((resolve) => setTimeout(() => resolve('LATE'), 40)),
    };
    const { account, calls, sessions } = setup({ providers: { apple: provider }, providerTimeoutMs: 10 });
    await sessions.set({ session: 'SESSION-X', provider: 'apple' });
    await rejectsWith(account.deleteAccount(), 'timeout');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.some((call) => call.startsWith('delete:')), false);
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('IDトークン・コードが空なら invalid-response（削除を呼ばない）', async () => {
    for (const idToken of ['', undefined, 5]) {
      const { account, calls, sessions } = setup({
        providers: { apple: { getIdToken: async () => idToken as unknown as string } },
      });
      await sessions.set({ session: 'SESSION-X', provider: 'apple' });
      await rejectsWith(account.deleteAccount(), 'invalid-response');
      assert.equal(calls.some((call) => call.startsWith('delete:')), false);
    }
    const web = setup({ providers: {}, codeProviders: { apple: { getAuthorizationCode: async () => '' } } });
    await web.sessions.set({ session: 'SESSION-X', provider: 'apple' });
    await rejectsWith(web.account.deleteAccount(), 'invalid-response');
  });

  it('再認証が通らない（reauth-failed）・別のアカウント（account-mismatch）は、そのまま返す。サインインは保つ', async () => {
    for (const code of ['reauth-failed', 'account-mismatch'] as const) {
      const { account, sessions } = setup({
        auth: {
          deleteAccount: async () => {
            throw new AuthError(code);
          },
        },
      });
      await account.signIn('apple');
      await rejectsWith(account.deleteAccount(), code);
      assert.equal((await sessions.read()).kind, 'found');
      assert.equal(await account.getSignedInProvider(), 'apple');
    }
  });

  it('401（サーバーがセッションを認めない）は unauthorized で、端末のセッションを捨てる', async () => {
    const { account, sessions } = setup({
      auth: {
        deleteAccount: async () => {
          throw new AuthError('unauthorized');
        },
      },
    });
    await account.signIn('apple');
    await rejectsWith(account.deleteAccount(), 'unauthorized');
    assert.equal((await sessions.read()).kind, 'none');
  });

  it('サーバーの不調（unavailable）では、セッションを捨てない。やり直せる', async () => {
    const { account, sessions } = setup({
      auth: {
        deleteAccount: async () => {
          throw new AuthError('unavailable');
        },
      },
    });
    await account.signIn('apple');
    await rejectsWith(account.deleteAccount(), 'unavailable');
    assert.equal((await sessions.read()).kind, 'found');
  });

  it('削除の要求を送ったあとの通信の失敗（network）は delete-unconfirmed（済んでいるかもしれない）。セッションは捨てない', async () => {
    const { account, sessions } = setup({
      auth: {
        deleteAccount: async () => {
          throw new AuthError('network');
        },
      },
    });
    await account.signIn('apple');
    await rejectsWith(account.deleteAccount(), 'delete-unconfirmed');
    assert.equal((await sessions.read()).kind, 'found');
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('削除の要求を送ったあとの応答が読めない（invalid-response。Workerが 200 を返すのは消したあと）も delete-unconfirmed。セッションは捨てない', async () => {
    const { account, sessions } = setup({
      auth: {
        deleteAccount: async () => {
          throw new AuthError('invalid-response');
        },
      },
    });
    await account.signIn('apple');
    await rejectsWith(account.deleteAccount(), 'delete-unconfirmed');
    assert.equal((await sessions.read()).kind, 'found');
  });

  it('T を得られなければ（通信の失敗）、各社の画面を開かない', async () => {
    const { account, hashed, sessions } = setup({
      auth: {
        requestNonce: async () => {
          throw new AuthError('network');
        },
      },
    });
    await sessions.set({ session: 'SESSION-X', provider: 'apple' });
    // 要求は、まだ送っていない（何も消えていない）ので、delete-unconfirmed ではなく、ふつうの network。
    await rejectsWith(account.deleteAccount(), 'network');
    assert.deepEqual(hashed, []);
  });

  it('AndroidのApple（認可コードの経路）も、T（web）の取得の通信の失敗は、ふつうの network', async () => {
    const { account, sessions } = setup({
      providers: {},
      codeProviders: { apple: { getAuthorizationCode: async () => 'CODE' } },
      auth: {
        requestWebNonce: async () => {
          throw new AuthError('network');
        },
      },
    });
    await sessions.set({ session: 'SESSION-X', provider: 'apple' });
    await rejectsWith(account.deleteAccount(), 'network');
  });

  it('削除は成功したが、端末のセッションを捨てられなくても、成功を返す（残った値は、次の呼び出しの 401 で捨てる）', async () => {
    const { account, sessions } = setup();
    await account.signIn('apple');
    sessions.clear = async () => {
      throw new Error('keystore failed');
    };
    // 成功は成功のまま。画面が「この端末はまだサインイン中」と伝えられるよう、`sessionCleared` で知らせる。
    assert.deepEqual(await account.deleteAccount(), { appleRevoked: true, sessionCleared: false });
  });

  it('組み込まれていない手段のセッション（手段のサインインが無い）は provider-unavailable。通信しない', async () => {
    const { account, calls, sessions } = setup({ providers: {}, codeProviders: {} });
    await sessions.set({ session: 'SESSION-X', provider: 'google' });
    await rejectsWith(account.deleteAccount(), 'provider-unavailable');
    assert.deepEqual(calls, []);
  });

  it('AuthError 以外の失敗は unexpected に包む。元の例外は載せない', async () => {
    const { account } = setup({
      auth: {
        deleteAccount: async () => {
          throw new Error('boom SECRET-TOKEN');
        },
      },
    });
    await account.signIn('apple');
    await assert.rejects(account.deleteAccount(), (error) => {
      return error instanceof AuthError && error.code === 'unexpected' && !error.message.includes('SECRET-TOKEN');
    });
  });

  it('サインインやログアウトと同じ列で、1本ずつ実行する（サインインの途中の削除は、サインインのあとに走る）', async () => {
    let release: (value: string) => void = () => {};
    const slow: IdTokenProvider = { getIdToken: () => new Promise<string>((resolve) => (release = resolve)) };
    const { account, sessions } = setup({ providers: { apple: slow } });
    const signingIn = account.signIn('apple');
    const deleting = account.deleteAccount().catch((error: unknown) => error);
    // サインインの途中では、削除はまだサインインしていない扱いにならない（列の後ろで待つ）。
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await sessions.read()).kind, 'none');
    release('ID-TOKEN');
    await signingIn;
    // 削除は、サインインのあとに走る。もう一度、各社の画面を開く（slow の2回目は、止まったまま）。
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await sessions.read()).kind, 'found');
    release('ID-TOKEN-2');
    await deleting;
    assert.equal((await sessions.read()).kind, 'none');
  });
});

describe('access.withSession（APIを呼ぶ層が使う、認証が要る呼び出しの入口）', () => {
  it('サインイン中のセッションを渡して task を実行し、結果を返す。端末のセッションは残す', async () => {
    const { account, sessions } = setup();
    await account.signIn('apple');
    assert.equal(await account.access.withSession(async (session) => `got:${session}`), 'got:SESSION-1');
    assert.equal((await sessions.read()).kind, 'found');
  });

  it('サインインしていなければ not-signed-in。保存先を読めなければ storage-failed。どちらも task を実行しない', async () => {
    const { account, items } = setup();
    let ran = 0;
    const task = async () => void (ran += 1);
    await rejectsWith(account.access.withSession(task), 'not-signed-in');
    items.set('warikan-seikatsu.session', 'garbage');
    await rejectsWith(account.access.withSession(task), 'storage-failed');
    assert.equal(ran, 0);
  });

  it('task が unauthorized（401）を投げたときだけ、端末のセッションを捨てる', async () => {
    const { account, sessions } = setup();
    await account.signIn('apple');
    for (const code of ['network', 'unavailable', 'invalid-response', 'invalid-request'] as const) {
      await rejectsWith(
        account.access.withSession(async () => {
          throw new AuthError(code);
        }),
        code,
      );
      assert.equal((await sessions.read()).kind, 'found', code);
    }
    await rejectsWith(
      account.access.withSession(async () => {
        throw new AuthError('unauthorized');
      }),
      'unauthorized',
    );
    assert.equal((await sessions.read()).kind, 'none');
    assert.equal(await account.getSignedInProvider(), null);
  });

  it('task が AuthError 以外を投げたら、そのまま投げる（包まない）。端末のセッションは捨てない', async () => {
    const { account, sessions } = setup();
    await account.signIn('apple');
    const failure = new Error('domain failure');
    await assert.rejects(
      account.access.withSession(async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.equal((await sessions.read()).kind, 'found');
  });

  it('401 のとき、端末のセッションを捨てられなくても、失敗は unauthorized のまま', async () => {
    const { account, sessions } = setup();
    await account.signIn('apple');
    sessions.clear = async () => {
      throw new Error('keychain error');
    };
    await rejectsWith(
      account.access.withSession(async () => {
        throw new AuthError('unauthorized');
      }),
      'unauthorized',
    );
  });

  it('サインイン・ログアウトの待ち（各社の画面を開いている間）に、巻き込まれない', async () => {
    let release: (token: string) => void = () => {};
    const slow: IdTokenProvider = { getIdToken: () => new Promise<string>((resolve) => (release = resolve)) };
    const { account, sessions } = setup({ providers: { apple: slow } });
    // 先に別の手段で入っているわけではない: サインイン中（画面が開いたまま）でも、access は待たずに not-signed-in を返す。
    const signingIn = account.signIn('apple');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await rejectsWith(account.access.withSession(async () => 1), 'not-signed-in');
    release('ID-TOKEN');
    await signingIn;
    assert.equal((await sessions.read()).kind, 'found');
  });
});

describe('保存先を読めない（unreadable）値の扱い（Singfolioに無い。docs/backend-design.md 12章の②）', () => {
  it('getSignedInProvider は、読めない値なら storage-failed（null にしない。「ログアウト中」と「分からない」を取り違えない）', async () => {
    const { account, items } = setup();
    assert.equal(await account.getSignedInProvider(), null); // 値が無い
    items.set('warikan-seikatsu.session', 'garbage');
    await assert.rejects(account.getSignedInProvider(), (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, 'storage-failed');
      return true;
    });
  });

  it('読み取りが一時的に失敗しても（端末がロック中など）storage-failed。読めるようになれば、サインイン中として読める', async () => {
    const { storage, items } = memoryStorage();
    await createSessionRepository(storage).set({ session: 'SESSION-1', provider: 'apple' });
    let locked = true;
    const account = createAccountService({
      auth: fakeAuth().auth,
      sessions: createSessionRepository({
        ...storage,
        getItemAsync: async (key) => {
          if (locked) throw new Error('keychain locked');
          return items.get(key) ?? null;
        },
      }),
      installMarker: installedMarker(),
      sha256Base64Url,
      idTokenProviders: {},
    });
    await rejectsWith(account.getSignedInProvider(), 'storage-failed');
    locked = false;
    assert.equal(await account.getSignedInProvider(), 'apple');
  });

  it('読めない値は、読むだけでは消さない（一時的な失敗かもしれない）', async () => {
    const { account, items } = setup();
    items.set('warikan-seikatsu.session', 'garbage');
    await rejectsWith(account.getSignedInProvider(), 'storage-failed');
    assert.equal(items.get('warikan-seikatsu.session'), 'garbage');
  });
});

describe('再インストール（印が無い起動は、前のセッションを捨てる）', () => {
  const OLD = { session: 'SESSION-OLD', provider: 'apple' } as const;

  it('印が無く、前のセッションが残っていれば、印を置いて、捨てる。サーバーでも失効させる。サインインしていない扱いになる', async () => {
    const { marker, state } = freshMarker();
    const { account, sessions, items, calls } = setup({ installMarker: marker });
    await sessions.set(OLD);
    assert.equal(await account.getSignedInProvider(), null);
    assert.equal(items.size, 0);
    assert.equal(state.present, true);
    assert.deepEqual(calls, ['logout:SESSION-OLD']);
  });

  it('捨てたあとは、サインインできる（already-signed-in にならない）。新しいセッションは、次の起動でも捨てない', async () => {
    const { marker } = freshMarker();
    const { account, sessions } = setup({ installMarker: marker, auth: { login: async () => 'SESSION-NEW' } });
    await sessions.set(OLD);
    await account.signIn('apple');
    assert.deepEqual(await sessions.read(), { kind: 'found', value: { session: 'SESSION-NEW', provider: 'apple' } });
    // 次の起動（同じ印）。印があるので、捨てない
    const next = setup({ installMarker: marker });
    await next.sessions.set({ session: 'SESSION-NEW', provider: 'apple' });
    assert.equal(await next.account.getSignedInProvider(), 'apple');
  });

  it('印があれば、セッションに触れない（捨てない・失効させない）', async () => {
    const { account, sessions, calls } = setup({ installMarker: installedMarker() });
    await sessions.set(OLD);
    assert.equal(await account.getSignedInProvider(), 'apple');
    assert.deepEqual(calls, []);
  });

  it('印が無くても、セッションが無ければ、印を置くだけ（通信しない）', async () => {
    const { marker, state } = freshMarker();
    const { account, calls } = setup({ installMarker: marker });
    assert.equal(await account.getSignedInProvider(), null);
    assert.equal(state.present, true);
    assert.deepEqual(calls, []);
  });

  it('読めない値も捨てる（失効させるものは特定できないので、通信しない）', async () => {
    const { marker } = freshMarker();
    const { account, items, calls } = setup({ installMarker: marker });
    items.set('warikan-seikatsu.session', 'garbage');
    assert.equal(await account.getSignedInProvider(), null);
    assert.equal(items.size, 0);
    assert.deepEqual(calls, []);
  });

  it('確かめるのは1回だけ。同時に呼ばれても、印を置くのは1回で、どの入口も捨て終わってから読む', async () => {
    const { marker, state } = freshMarker();
    const { account, sessions } = setup({ installMarker: marker });
    await sessions.set(OLD);
    const [provider, signedOut] = await Promise.all([account.getSignedInProvider(), account.signOut()]);
    assert.equal(provider, null);
    assert.deepEqual(signedOut, { serverRevoked: true }); // 捨てたあとなので、値は無い
    assert.equal(state.sets, 1);
  });

  it('サーバーでの失効を待たない（応答が無くても、読み取りは進む）。失効の失敗も無視する', async () => {
    const { marker } = freshMarker();
    const hanging = setup({ installMarker: marker, auth: { logout: () => new Promise<void>(() => {}) } });
    await hanging.sessions.set(OLD);
    assert.equal(await hanging.account.getSignedInProvider(), null);

    const failing = setup({
      installMarker: freshMarker().marker,
      auth: {
        logout: async () => {
          throw new AuthError('network');
        },
      },
    });
    await failing.sessions.set(OLD);
    assert.equal(await failing.account.getSignedInProvider(), null);
  });

  it('印を読めない・置けないときは、何も捨てない（印が置けないまま、起動のたびに捨てないため）。起動は止めない', async () => {
    for (const marker of [
      {
        exists: async (): Promise<boolean> => {
          throw new Error('disk error');
        },
        set: async () => {},
      },
      {
        exists: async () => false,
        set: async (): Promise<void> => {
          throw new Error('disk full');
        },
      },
    ] satisfies InstallMarker[]) {
      const { account, sessions, calls } = setup({ installMarker: marker });
      await sessions.set(OLD);
      assert.equal(await account.getSignedInProvider(), 'apple');
      assert.deepEqual(calls, []);
    }
  });

  it('捨てられなかったとき（端末がロック中など）は、印は置いたまま、前のセッションが残る。起動は止めない。失効もさせない', async () => {
    const { marker, state } = freshMarker();
    const { storage } = memoryStorage();
    const sessions = createSessionRepository({
      ...storage,
      deleteItemAsync: async () => {
        throw new Error('keychain locked');
      },
    });
    await sessions.set(OLD);
    const { auth, calls } = fakeAuth();
    const account = createAccountService({
      auth,
      sessions,
      installMarker: marker,
      sha256Base64Url,
      idTokenProviders: {},
    });
    assert.equal(await account.getSignedInProvider(), 'apple');
    assert.equal(state.present, true);
    assert.deepEqual(calls, []); // 端末に残っているので、失効させない
  });

  it('サインアウト・削除・API呼び出しの入口も、先に確かめる（前のセッションで、サーバーを呼ばない）', async () => {
    const { account, sessions, calls } = setup({ installMarker: freshMarker().marker });
    await sessions.set(OLD);
    await rejectsWith(account.access.withSession(async () => 1), 'not-signed-in');
    assert.deepEqual(calls, ['logout:SESSION-OLD']); // 失効だけ。withSession の task は動かない

    const second = setup({ installMarker: freshMarker().marker });
    await second.sessions.set(OLD);
    await rejectsWith(second.account.deleteAccount(), 'not-signed-in');
    assert.deepEqual(second.calls, ['logout:SESSION-OLD']);
  });
});
