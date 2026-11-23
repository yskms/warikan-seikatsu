/// <reference types="node" />
// Singfolio（worker/test/deleteAccount.test.ts）からのコピー（コピー元: singfolio 61e0a82）から、このアプリにあるものだけを残し、
// このアプリのデータ処理（グループの匿名化・削除、競合）の検査を足した。
// 除いたもの: AndroidのAppleログイン（Web経由）の再認証、公開プロフィール（R2）の削除。
// アカウントの削除（POST /auth/delete）を、模擬の発行元（テスト用のRSA鍵で署名し、JWKSを返す fetch）・模擬のApple
// （/auth/token・/auth/revoke を返す fetch）・ローカルD1で確かめる。ネットワークには出ない。
// 順序（再認証が通ってから消す）、`sub` の一致、Appleのトークンの失効が削除を止めないこと、失敗の応答の分け方を見る。
// グループごとの匿名化・削除の中身そのものは、accountDeletion.test.ts。ここでは、つながっていること（入口から、
// そのデータ処理が呼ばれる）と、競合し続けたときの応答を見る。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { createAppleCodeExchanger } from '../src/appleToken.ts';
import { handleDeleteAccount } from '../src/deleteAccount.ts';
import worker from '../src/index.ts';
import { createIdTokenVerifier, type FetchFunction, type IdTokenProvider, type IdTokenVerifier } from '../src/idToken.ts';
import { resolveIdentity } from '../src/identity.ts';
import { DELETED_USER_NAME } from '../src/membership.ts';
import { consumeNonce, issueNonce, nonceHash } from '../src/nonce.ts';
import { authenticateSession, createSession } from '../src/session.ts';
import { createFixtureFactory, equalShares, insertCategoryRule } from './apiFixture.ts';
import { openLocalDatabase, type LocalDatabase } from './localDatabase.ts';
import { countingEnv, interferingEnv } from './monthApi.ts';

const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const SECRET = 'test-secret-value-0123456789abcdef';
const BUNDLE_ID = 'com.example.app';
// このアプリの設定（wrangler.jsonc）には無い。ネイティブのトークンの aud に、Services ID を受け付けないことの検査に使う。
const SERVICES_ID = 'com.example.web';
const GOOGLE_CLIENT_ID = '1234-web.apps.googleusercontent.com';
const TEAM_ID = 'TEAM123456';
const KEY_ID = 'KEY1234567';
const SUB = 'apple-sub-1';
const REFRESH = 'REFRESH-TOKEN-SECRET';
const ACCESS = 'ACCESS-TOKEN-SECRET';

const issuerKey = await (async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  return { privateKey: privateKey as CryptoKey, jwk: { ...(await exportJWK(publicKey)), kid: 'key-a', alg: 'RS256', use: 'sig' } as JWK };
})();
const impostorKey = (await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })).privateKey as CryptoKey;
const APPLE_PRIVATE_KEY = await exportPKCS8((await generateKeyPair('ES256', { extractable: true })).privateKey);

describe('POST /auth/delete', () => {
  let local: LocalDatabase;
  let db: D1Database;
  let env: Env;
  let factory: ReturnType<typeof createFixtureFactory>;
  let verifier: IdTokenVerifier;
  let jwksFails: boolean;
  let logs: string[];
  // 模擬のApple。/auth/token と /auth/revoke への呼び出しを記録する。
  // `present`: その呼び出しの時点で、D1に、再認証したアカウント（`SUB`）の行が残っているか（呼び出しと削除の前後を見る）。
  let appleCalls: Array<{ url: string; form: URLSearchParams; present: boolean }>;
  let tokenResponse: ((form: URLSearchParams) => Response | Promise<Response>) | null;
  let revokeResponse: (() => Response | Promise<Response>) | null;

  before(async () => {
    local = await openLocalDatabase();
    db = local.db;
    factory = createFixtureFactory(db);
    // vars の型は、wrangler.jsonc の値のリテラル型。テスト用の別の値を入れるので、unknown を経由する。
    env = {
      NONCE_HMAC_KEY: SECRET,
      APPLE_BUNDLE_ID: BUNDLE_ID,
      APPLE_TEAM_ID: TEAM_ID,
      APPLE_KEY_ID: KEY_ID,
      APPLE_PRIVATE_KEY,
      GOOGLE_WEB_CLIENT_ID: GOOGLE_CLIENT_ID,
      DB: db,
    } as unknown as Env;
  });
  after(async () => {
    await local.dispose();
  });

  const exchanger = createAppleCodeExchanger({
    fetch: async (url, init) => {
      const form = new URLSearchParams(String(init.body));
      const row = await db.prepare('SELECT COUNT(*) AS n FROM identities WHERE sub = ?').bind(SUB).first<{ n: number }>();
      appleCalls.push({ url, form, present: row!.n > 0 });
      if (url.endsWith('/auth/revoke')) return revokeResponse ? revokeResponse() : new Response('', { status: 200 });
      return tokenResponse!(form);
    },
    log: (message) => logs.push(message),
  });

  beforeEach(async () => {
    // users の削除で identities・sessions も消える（グループのメンバー行は `user_id` が NULL になって残る。各テストは新しいグループを作る）。
    await db.batch([db.prepare('DELETE FROM used_nonces'), db.prepare('DELETE FROM users')]);
    jwksFails = false;
    logs = [];
    appleCalls = [];
    tokenResponse = null;
    revokeResponse = null;
    const fetchFunction: FetchFunction = async () =>
      jwksFails ? new Response('down', { status: 500 }) : Response.json({ keys: [issuerKey.jwk] });
    verifier = createIdTokenVerifier({ fetch: fetchFunction });
  });

  const counts = async () => {
    const result: Record<string, number> = {};
    for (const table of ['users', 'identities', 'sessions', 'used_nonces']) {
      result[table] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
    }
    return result;
  };

  /** ログイン済みのユーザーを作る（セッションの値を返す）。 */
  async function signedIn(provider: IdTokenProvider = 'apple', sub = SUB, idleMs = 1000) {
    const { identityId, userId } = await resolveIdentity(db, provider, sub, NOW - 1000);
    const session = (await createSession(db, identityId, NOW - idleMs))!;
    return { identityId, userId, session };
  }

  const issueT = async (now = NOW) => (await issueNonce(SECRET, { kind: 'native' }, now)).nonce;

  interface TokenOptions {
    provider?: IdTokenProvider;
    sub?: string;
    aud?: string;
    nonceClaim?: string | null;
    exp?: number;
    key?: CryptoKey;
  }
  async function signToken(
    t: string,
    { provider = 'apple', sub = SUB, aud, nonceClaim, exp = NOW_S + 600, key = issuerKey.privateKey }: TokenOptions = {},
  ) {
    const claims: Record<string, unknown> = {
      iss: provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com',
      aud: aud ?? (provider === 'apple' ? BUNDLE_ID : GOOGLE_CLIENT_ID),
      sub,
      iat: NOW_S - 10,
      exp,
    };
    if (nonceClaim !== null) claims.nonce = nonceClaim ?? (await nonceHash(t));
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'key-a' }).sign(key);
  }

  const call = (session: string | undefined, body: unknown, { now = NOW, method = 'POST' } = {}) =>
    handleDeleteAccount(
      new Request('https://example.test/auth/delete', {
        method,
        headers: {
          'content-type': 'application/json',
          ...(session === undefined ? {} : { authorization: `Bearer ${session}` }),
        },
        body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
      now,
      { verifier, exchanger, log: (message) => logs.push(message) },
    );

  /** iOSのAppleの再認証の本文。 */
  async function appleNative(options: TokenOptions & { authorizationCode?: string | null } = {}) {
    const t = await issueT();
    const body: Record<string, unknown> = { provider: 'apple', nonce: t, idToken: await signToken(t, options) };
    if (options.authorizationCode !== null) body.authorizationCode = options.authorizationCode ?? 'native-code';
    return { t, body };
  }
  async function google(options: TokenOptions = {}) {
    const t = await issueT();
    return { t, body: { provider: 'google', nonce: t, idToken: await signToken(t, { provider: 'google', ...options }) } };
  }
  const deleted = async () => assert.deepEqual(await counts(), { users: 0, identities: 0, sessions: 0, used_nonces: 1 });

  describe('成功', () => {
    it('Apple（iOS）: 再認証が通ったら、アカウントごと消し、認可コードを交換して、トークンを失効させる', async () => {
      const { session, userId } = await signedIn();
      const bystander = await signedIn('apple', 'apple-sub-bystander');
      tokenResponse = () => Response.json({ id_token: 'UNUSED', refresh_token: REFRESH, access_token: ACCESS });
      const { body } = await appleNative();
      const response = await call(session, body);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { appleRevoked: true });

      assert.equal(await authenticateSession(db, session, NOW), null);
      assert.equal(
        (await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(userId).first<{ n: number }>())!.n,
        0,
      );
      // ほかの人は消さない。
      assert.notEqual(await authenticateSession(db, bystander.session, NOW), null);
      assert.deepEqual(await counts(), { users: 1, identities: 1, sessions: 1, used_nonces: 1 });

      // Appleへ: 認可コードの交換（バンドルIDの client_id。redirect_uri は付けない）、そのトークンの失効。
      assert.equal(appleCalls.length, 2);
      const [exchange, revoke] = appleCalls as [(typeof appleCalls)[number], (typeof appleCalls)[number]];
      assert.equal(exchange.url, 'https://appleid.apple.com/auth/token');
      assert.equal(exchange.form.get('client_id'), BUNDLE_ID);
      assert.equal(exchange.form.get('code'), 'native-code');
      assert.equal(exchange.form.get('grant_type'), 'authorization_code');
      assert.equal(exchange.form.has('redirect_uri'), false);
      assert.equal(revoke.url, 'https://appleid.apple.com/auth/revoke');
      assert.equal(revoke.form.get('client_id'), BUNDLE_ID);
      assert.equal(revoke.form.get('token'), REFRESH);
      assert.equal(revoke.form.get('token_type_hint'), 'refresh_token');
      assert.ok((revoke.form.get('client_secret') ?? '').length > 0);
      assert.deepEqual(logs, []);
    });

    it('Apple（iOS）: 認可コードの交換は、D1を消す前。失効だけが、消したあと（消したあとに待つのを、1回にする）', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'UNUSED', refresh_token: REFRESH });
      assert.equal((await call(session, (await appleNative()).body)).status, 200);
      assert.deepEqual(
        appleCalls.map((c) => [c.url.endsWith('/auth/token') ? 'exchange' : 'revoke', c.present]),
        [
          ['exchange', true],
          ['revoke', false],
        ],
      );
    });

    it('Apple: refresh_token が無ければ、access_token を失効させる', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'UNUSED', access_token: ACCESS });
      assert.deepEqual(await (await call(session, (await appleNative()).body)).json(), { appleRevoked: true });
      assert.equal(appleCalls[1]!.form.get('token'), ACCESS);
      assert.equal(appleCalls[1]!.form.get('token_type_hint'), 'access_token');
    });

    it('Google: Appleには何も送らない。appleRevoked は null', async () => {
      const { session } = await signedIn('google', 'google-sub-1');
      const { body } = await google({ sub: 'google-sub-1' });
      const response = await call(session, body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleRevoked: null });
      await deleted();
      assert.deepEqual(appleCalls, []);
    });

    it('複数のログイン手段・複数の端末のセッションも、すべて消える', async () => {
      const { session, userId, identityId } = await signedIn();
      const other = (await createSession(db, identityId, NOW))!;
      const googleIdentity = crypto.randomUUID();
      await db
        .prepare(`INSERT INTO identities (id, user_id, provider, sub, created_at, last_sign_in_at) VALUES (?1, ?2, 'google', 'g-1', ?3, ?3)`)
        .bind(googleIdentity, userId, NOW)
        .run();
      const googleSession = (await createSession(db, googleIdentity, NOW))!;
      const { body } = await appleNative({ authorizationCode: null });
      assert.equal((await call(session, body)).status, 200);
      for (const value of [session, other, googleSession]) assert.equal(await authenticateSession(db, value, NOW), null);
      assert.deepEqual(await counts(), { users: 0, identities: 0, sessions: 0, used_nonces: 1 });
    });
  });

  // グループごとの匿名化・削除の中身は accountDeletion.test.ts。ここでは、入口から、そのデータ処理がつながっていることを見る。
  describe('グループのデータ（accountDeletion.ts につながっている）', () => {
    const member = (memberId: string) =>
      db
        .prepare('SELECT user_id, display_name, status FROM group_members WHERE id = ?')
        .bind(memberId)
        .first<{ user_id: string | null; display_name: string; status: string }>();
    const groupExists = async (groupId: string) =>
      (await db.prepare('SELECT COUNT(*) AS n FROM expense_groups WHERE id = ?').bind(groupId).first<{ n: number }>())!.n === 1;
    const dataVersion = async (groupId: string) =>
      (await db.prepare('SELECT data_version FROM expense_groups WHERE id = ?').bind(groupId).first<{ data_version: number }>())!
        .data_version;

    /** 自分（Apple）が、残る人のいるグループ A と、自分だけのグループ B に入っている。X は無関係のグループ。 */
    async function setup() {
      const me = await signedIn();
      const a = await factory.createGroup(['bob', 'carol']);
      const myMemberInA = await factory.addMember(a.groupId, 'me', me.userId);
      await insertCategoryRule(
        db,
        a.groupId,
        a.categoryId,
        '2026-10',
        equalShares([a.people.bob.memberId, a.people.carol.memberId, myMemberInA]),
      );
      const b = await factory.createGroup([] as string[]);
      const myMemberInB = await factory.addMember(b.groupId, 'me', me.userId);
      const x = await factory.createGroup(['xavier']);
      return { me, a, b, x, myMemberInA, myMemberInB };
    }

    it('再認証が通ると、残る人のいるグループは匿名化し、自分だけのグループは消す。ほかのグループには触れない', async () => {
      const { me, a, b, x, myMemberInA, myMemberInB } = await setup();
      const versionA = await dataVersion(a.groupId);
      const versionX = await dataVersion(x.groupId);
      tokenResponse = () => Response.json({ id_token: 'UNUSED', refresh_token: REFRESH });
      const response = await call(me.session, (await appleNative()).body);
      assert.equal(response.status, 200);
      // 応答は、Appleの失効の結果だけ（グループの数などを返さない）。
      assert.deepEqual(await response.json(), { appleRevoked: true });

      assert.deepEqual(await member(myMemberInA), { user_id: null, display_name: DELETED_USER_NAME, status: 'deleted' });
      assert.equal(await dataVersion(a.groupId), versionA + 1);
      assert.equal(await groupExists(b.groupId), false);
      assert.equal(await member(myMemberInB), null);
      // 他の人の行・グループは、そのまま。
      assert.deepEqual(await member(a.people.bob.memberId), {
        user_id: a.people.bob.userId,
        display_name: 'bob',
        status: 'active',
      });
      assert.equal(await dataVersion(x.groupId), versionX);
      assert.equal(await authenticateSession(db, me.session, NOW), null);
    });

    it('再認証が通らなければ、グループのデータも変えない', async () => {
      const { me, a, b, myMemberInA } = await setup();
      const versionA = await dataVersion(a.groupId);
      const { body } = await appleNative({ sub: 'apple-sub-other' });
      assert.equal((await call(me.session, body)).status, 403);
      assert.equal(await dataVersion(a.groupId), versionA);
      assert.equal((await member(myMemberInA))!.status, 'active');
      assert.equal(await groupExists(b.groupId), true);
    });

    // ローカルD1は、クエリ数の上限を課さない。batch の文を1つずつ数える見積もりでは、Freeの本番で、1グループでも2回の競合で上限（50）を
    // 超え、この503の手前で、未処理の例外（500）になる（下の「D1のクエリ数」）。公式のとおり batch を1回と数えるなら、3回の競合でも
    // 約25で、この503に届く。ここで見るのは、その経路（応答の形と、何も消えないこと）。
    it('他の書き込みと競合し続けたら 503。何も消さず、セッションも有効なまま。T は使い切りなので、再認証からやり直せば消える', async () => {
      const { me, a, b, myMemberInA } = await setup();
      const bump = () => db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(a.groupId).run();
      tokenResponse = () => Response.json({ id_token: 'UNUSED', refresh_token: REFRESH });
      const original = env;
      // 先頭の1回の batch は、T を使用済みにする書き込み。そのあとの、データ処理の書き込み3回に割り込む。
      env = interferingEnv(original, bump, { times: 3, skipBatches: 1 });
      let response: Response;
      try {
        response = await call(me.session, (await appleNative()).body);
      } finally {
        env = original;
      }
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'service_unavailable' });

      // 何も消えていない。セッションも有効なまま（アプリは 503 のとき、端末のセッションを捨てない）。
      assert.notEqual(await authenticateSession(db, me.session, NOW), null);
      assert.equal((await member(myMemberInA))!.status, 'active');
      assert.equal(await groupExists(b.groupId), true);
      assert.equal((await counts()).used_nonces, 1);
      // 消す前に済ませた認可コードの交換は行われたが、削除が済んでいないので、失効は行わない。
      assert.deepEqual(
        appleCalls.map((call) => call.url),
        ['https://appleid.apple.com/auth/token'],
      );

      // 再認証（新しい T と認可コード）からやり直せば、消える。
      appleCalls.length = 0;
      const retry = await call(me.session, (await appleNative()).body);
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { appleRevoked: true });
      assert.equal((await member(myMemberInA))!.status, 'deleted');
      assert.equal(await groupExists(b.groupId), false);
    });
  });

  // POST /auth/delete 全体のD1のクエリ数。batch の文を1つずつ数えた、安全側の数（公式は batch を1回と数えると書く。docs/backend-design.md 8章の
  // 「D1のクエリ数の数え方」）。Freeは1回の呼び出しにつき50まで（12章）。`accountDeletion.test.ts` は
  // データ処理だけを数える。ここは、その前の認証（セッションの検索と、24時間以上前なら更新の2文）と、T を使用済みにする2文も含め、
  // やり直しの試行も含めて数える。ローカルD1は上限を課さないので、上限を超える数も、そのまま測れる。
  // この数え方で上限に当たると、`batch` が例外を投げ、`POST /auth/delete` は未処理の例外（500）になる。何も消えない。
  describe('D1のクエリ数（batch の文を1つずつ数える。Freeは1回の呼び出しにつき50まで）', () => {
    const FREE_LIMIT = 50;
    const HOURS = 60 * 60 * 1000;
    let sequence = 0;

    interface Shape {
      /** 残る2人がいる、参加中のグループの数。 */
      shared?: number;
      /** 自分だけの（削除するとグループごと消える）グループの数。 */
      solo?: number;
      /** 脱退済み（`left`）のグループの数（匿名化だけ）。 */
      left?: number;
      /** 参加中のグループそれぞれに、翌月より先で割合の行がある月を、いくつ作るか。 */
      farMonths?: number;
      /** セッションを最後に使ってからの時間（24時間以上だと、認証が最後に使った時刻を更新する）。 */
      idleHours?: number;
      /** 最初のグループに割り込む書き込みの回数（データ処理がやり直す）。 */
      conflicts?: number;
    }

    /** そういう人が、Googleの再認証でアカウントを削除したときの、応答の状態と、D1のクエリ数。 */
    async function measure(shape: Shape) {
      const sub = `google-count-${++sequence}`;
      const me = await signedIn('google', sub, (shape.idleHours ?? 0) * HOURS || 1000);
      const groupIds: string[] = [];
      const addGroup = async (kind: 'shared' | 'solo' | 'left') => {
        const g = await factory.createGroup(kind === 'solo' ? [] : ['zed', 'yan']);
        const others = Object.values(g.people).map((person) => person.memberId);
        const mine = await factory.addMember(
          g.groupId,
          'alice',
          me.userId,
          kind === 'left' ? { status: 'left', expenseEndMonth: '2026-11' } : {},
        );
        const members = kind === 'left' ? others : [...others, mine];
        await insertCategoryRule(db, g.groupId, g.categoryId, '2026-10', equalShares(members));
        if (kind !== 'left') {
          // 今は2027-01。翌月（2027-02）は、削除で必ず直す月。それより先（2027-03〜）に行がある月が、追加の費用になる。
          const months = ['2027-02', '2027-03', '2027-04'].slice(0, shape.farMonths ? 1 + shape.farMonths : 0);
          for (const month of months) await insertCategoryRule(db, g.groupId, g.categoryId, month, equalShares(members));
        }
        groupIds.push(g.groupId);
      };
      for (const [kind, n] of [['shared', shape.shared], ['solo', shape.solo], ['left', shape.left]] as const) {
        for (let i = 0; i < (n ?? 0); i++) await addGroup(kind);
      }

      const { body } = await google({ sub });
      const bump = () =>
        db.prepare('UPDATE expense_groups SET data_version = data_version + 1 WHERE id = ?').bind(groupIds[0]).run();
      // 先頭の1回の batch は、T を使用済みにする書き込み。割り込みは、そのあとの、データ処理の書き込みに入れる。
      const counting = countingEnv(
        shape.conflicts ? interferingEnv(env, bump, { times: shape.conflicts, skipBatches: 1 }) : env,
      );
      const original = env;
      env = counting.env;
      try {
        const response = await call(me.session, body);
        return { status: response.status, queries: counting.counts.queries };
      } finally {
        env = original;
      }
    }
    const queriesOf = async (shape: Shape) => (await measure(shape)).queries;

    it('残る人がいるグループ: 基本の11 + グループごとに9。1文ずつ数えて、Freeに収まるのは4グループまで（セッションが古いと49）', async () => {
      // 11 = セッションの検索1 + T の使用済み2 + データ処理の読み込み6 + バージョンの更新1 + users の削除1。
      const counts: number[] = [];
      for (const shared of [1, 2, 3, 4, 5]) counts.push(await queriesOf({ shared }));
      assert.deepEqual(counts, [20, 29, 38, 47, 56]);
      // セッションを24時間以上使っていないと、認証が最後に使った時刻を更新する（2文）。
      assert.equal(await queriesOf({ shared: 4, idleHours: 25 }), 49);
      assert.equal(await queriesOf({ shared: 5, idleHours: 25 }), 58);
      assert.ok(47 <= FREE_LIMIT && 49 <= FREE_LIMIT && 56 > FREE_LIMIT);
    });

    it('自分だけのグループ（グループごと消す）は、1つにつき15。3つで、1文ずつ数えるとFreeを超える', async () => {
      const counts: number[] = [];
      for (const solo of [1, 2, 3]) counts.push(await queriesOf({ solo }));
      assert.deepEqual(counts, [26, 41, 56]);
      assert.ok(counts[1]! <= FREE_LIMIT && counts[2]! > FREE_LIMIT);
    });

    it('翌月より先に割合の行がある月は、グループごと・月ごとに4つ増える。3グループでも、セッションが古いと、1文ずつ数えて50を超える', async () => {
      assert.equal(await queriesOf({ shared: 3, farMonths: 1 }), 50);
      assert.equal(await queriesOf({ shared: 3, farMonths: 1, idleHours: 25 }), 52);
      assert.equal(await queriesOf({ shared: 3, farMonths: 2 }), 62);
      assert.ok(52 > FREE_LIMIT);
    });

    it('脱退済みのグループは、匿名化だけで、1つにつき2。増え続ける', async () => {
      const counts: number[] = [];
      for (const left of [1, 2, 3]) counts.push(await queriesOf({ shared: 3, left }));
      assert.deepEqual(counts, [40, 42, 44]);
    });

    it('競合してやり直すたびに、読み込み6 + 書き込みの全体が加わる。1グループでも、2回の競合で、1文ずつ数えるとFreeを超える', async () => {
      const results = [];
      for (const conflicts of [0, 1, 2, 3]) results.push(await measure({ shared: 1, conflicts }));
      // 3回目の競合までに、すべての試行を使い切ると 503（Paidの上限では、起きる経路）。
      assert.deepEqual(results, [
        { status: 200, queries: 20 },
        { status: 200, queries: 37 },
        { status: 200, queries: 54 },
        { status: 503, queries: 54 },
      ]);
      assert.ok(results[1]!.queries <= FREE_LIMIT && results[2]!.queries > FREE_LIMIT);
    });
  });

  describe('Appleのトークンの失効は、削除を止めない', () => {
    it('iOSで認可コードが付いていない: 消して、appleRevoked は false（Appleは呼ばない）', async () => {
      const { session } = await signedIn();
      const { body } = await appleNative({ authorizationCode: null });
      const response = await call(session, body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleRevoked: false });
      await deleted();
      assert.deepEqual(appleCalls, []);
    });

    it('認可コードの交換が失敗（無効・Appleの不調）: 消して、appleRevoked は false', async () => {
      for (const response of [
        () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
        () => new Response('oops', { status: 500 }),
        () => Response.json({ id_token: 'x' }), // トークンが無い
      ]) {
        await db.batch([db.prepare('DELETE FROM used_nonces'), db.prepare('DELETE FROM users')]);
        const { session } = await signedIn();
        tokenResponse = response;
        const { body } = await appleNative();
        const result = await call(session, body);
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), { appleRevoked: false });
        await deleted();
      }
    });

    it('失効の失敗（Appleの400・通信の失敗）: 消して、appleRevoked は false。分類を1行だけ記録する', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'x', refresh_token: REFRESH });
      revokeResponse = () => Response.json({ error: 'invalid_client', error_description: 'SECRET-DESCRIPTION' }, { status: 400 });
      const { body } = await appleNative();
      const response = await call(session, body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleRevoked: false });
      await deleted();
      assert.deepEqual(logs, ['apple token revoke failed: status=400 error=invalid_client']);

      logs.length = 0;
      await db.batch([db.prepare('DELETE FROM used_nonces'), db.prepare('DELETE FROM users')]);
      const second = await signedIn();
      revokeResponse = () => {
        throw new Error('connect failed SECRET-DETAIL');
      };
      assert.deepEqual(await (await call(second.session, (await appleNative()).body)).json(), { appleRevoked: false });
      assert.deepEqual(logs, ['apple token revoke failed: network']);
    });

    it('鍵の設定の不備（APPLE_PRIVATE_KEY）でも、消す。appleRevoked は false。鍵・例外の中身は記録しない', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'x', refresh_token: REFRESH });
      const broken = { ...env, APPLE_PRIVATE_KEY: 'replace-with-a-throwaway-pkcs8-ec-key' } as Env;
      const { body } = await appleNative();
      const response = await handleDeleteAccount(
        new Request('https://example.test/auth/delete', {
          method: 'POST',
          headers: { authorization: `Bearer ${session}` },
          body: JSON.stringify(body),
        }),
        broken,
        NOW,
        { verifier, exchanger, log: (message) => logs.push(message) },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleRevoked: false });
      await deleted();
      // iOS: 交換（D1を消す前）の段階で、鍵を読めない。失効の段階の分類（`revoke`）とは別の行にする（`wrangler tail` で切り分ける）。
      assert.deepEqual(logs, ['apple token exchange failed: unexpected']);
    });

    it('失効だけが例外で終わっても、消す。appleRevoked は false。失効の段階の分類を記録する', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'UNUSED', refresh_token: REFRESH });
      const throwingRevoke = {
        ...exchanger,
        revoke: async () => {
          throw new Error('SECRET-DETAIL');
        },
      };
      const { body } = await appleNative();
      const response = await handleDeleteAccount(
        new Request('https://example.test/auth/delete', {
          method: 'POST',
          headers: { authorization: `Bearer ${session}` },
          body: JSON.stringify(body),
        }),
        env,
        NOW,
        { verifier, exchanger: throwingRevoke, log: (message) => logs.push(message) },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { appleRevoked: false });
      await deleted();
      assert.deepEqual(logs, ['apple token revoke failed: unexpected']);
    });

    it('記録・応答に、トークン・コード・IDトークンを出さない', async () => {
      const { session } = await signedIn();
      tokenResponse = () => Response.json({ id_token: 'x', refresh_token: REFRESH, access_token: ACCESS });
      revokeResponse = () => new Response('<html>REFRESH-TOKEN-SECRET</html>', { status: 502 });
      const { body } = await appleNative({ authorizationCode: 'THE-NATIVE-CODE' });
      const response = await call(session, body);
      const text = await response.text();
      for (const secret of [REFRESH, ACCESS, 'THE-NATIVE-CODE', body.idToken as string]) {
        assert.equal(text.includes(secret), false);
        assert.equal(logs.join('\n').includes(secret), false);
      }
      assert.deepEqual(logs, ['apple token revoke failed: status=502 unreadable']);
    });
  });

  describe('再認証が通らなければ、何も消さない（403。セッションは捨てさせない）', () => {
    const notDeleted = async (session: string, expected = { users: 1, identities: 1, sessions: 1, used_nonces: 0 }) => {
      assert.notEqual(await authenticateSession(db, session, NOW), null);
      assert.deepEqual(await counts(), expected);
    };
    const forbidden = async (response: Response, error: string) => {
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error });
    };

    it('別のアカウント（sub が違う）で再認証すると、account_mismatch。T は使い切りにしない', async () => {
      const { session } = await signedIn();
      const { body } = await appleNative({ sub: 'apple-sub-other' });
      await forbidden(await call(session, body), 'account_mismatch');
      await notDeleted(session);
      assert.deepEqual(appleCalls, []);
    });

    it('別のユーザーの sub で再認証しても、自分のアカウントは消えず、相手も消えない', async () => {
      const mine = await signedIn('apple', 'apple-sub-mine');
      const theirs = await signedIn('apple', 'apple-sub-theirs');
      const { body } = await appleNative({ sub: 'apple-sub-theirs' });
      await forbidden(await call(mine.session, body), 'account_mismatch');
      assert.notEqual(await authenticateSession(db, mine.session, NOW), null);
      assert.notEqual(await authenticateSession(db, theirs.session, NOW), null);
      assert.deepEqual(await counts(), { users: 2, identities: 2, sessions: 2, used_nonces: 0 });
    });

    it('同じ sub でも、手段が違う（Google の sub を Apple のセッションで使う）と通らない', async () => {
      const { session } = await signedIn('apple', SUB);
      const { body } = await google({ sub: SUB });
      assert.equal((await call(session, body)).status, 400); // 手段の取り違え
      await notDeleted(session);
    });

    it('IDトークンの不備は reauth_failed（署名・aud・期限・nonce の欠落と不一致）', async () => {
      const { session } = await signedIn();
      for (const options of [
        { key: impostorKey },
        { aud: 'com.attacker.app' },
        { aud: SERVICES_ID }, // 経路と違う aud（native に Services ID）
        { exp: NOW_S - 3600 },
        { nonceClaim: null },
        { nonceClaim: 'A'.repeat(43) },
      ] satisfies TokenOptions[]) {
        const { body } = await appleNative(options);
        await forbidden(await call(session, body), 'reauth_failed');
      }
      await notDeleted(session);
    });

    it('T の不備は reauth_failed（期限切れ・署名違い・種別違い）。使用済みの T も通らない', async () => {
      const { session } = await signedIn();
      const t = await issueT();
      const idToken = await signToken(t);
      await forbidden(await call(session, { provider: 'apple', nonce: t, idToken }, { now: NOW + 6 * 60 * 1000 }), 'reauth_failed');
      const forged = await issueNonce('another-secret-value-0123456789abcdef', { kind: 'native' }, NOW);
      await forbidden(
        await call(session, { provider: 'apple', nonce: forged.nonce, idToken: await signToken(forged.nonce) }),
        'reauth_failed',
      );
      // `web` の T（AndroidのAppleログイン用）は、ネイティブの再認証に使えない。
      const webT = (await issueNonce(SECRET, { kind: 'web', challenge: await nonceHash('verifier') }, NOW)).nonce;
      await forbidden(await call(session, { provider: 'apple', nonce: webT, idToken: await signToken(webT) }), 'reauth_failed');

      // 使用済み（リプレイ）。再認証が通っても、T が使い切りなら消さない。
      const used = await issueT();
      const usedToken = await signToken(used);
      assert.equal(await consumeNonce(db, await nonceHash(used), NOW + 300_000, NOW), true);
      await forbidden(await call(session, { provider: 'apple', nonce: used, idToken: usedToken }), 'reauth_failed');
      await notDeleted(session, { users: 1, identities: 1, sessions: 1, used_nonces: 1 });
    });

    it('同じ再認証の本文を、2回送れない（成功したあとは、セッションが無いので 401）', async () => {
      const { session } = await signedIn();
      const { body } = await appleNative({ authorizationCode: null });
      assert.equal((await call(session, body)).status, 200);
      assert.equal((await call(session, body)).status, 401);
    });
  });

  describe('使えないとき（503。何も消さない）', () => {
    it('公開鍵を取得できず、使える古い鍵も無い', async () => {
      const { session } = await signedIn();
      jwksFails = true;
      const { body } = await appleNative();
      const response = await call(session, body);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'service_unavailable' });
      assert.deepEqual(await counts(), { users: 1, identities: 1, sessions: 1, used_nonces: 0 });
    });
  });

  describe('セッションの認証と、本文の形', () => {
    it('Authorization が無い・形が違う・無効（失効済み）なセッションは 401（何も消さない）', async () => {
      const { session } = await signedIn();
      const revoked = await signedIn('apple', 'apple-sub-revoked');
      await db.prepare('DELETE FROM sessions WHERE identity_id = ?').bind(revoked.identityId).run();
      const { body } = await appleNative();
      for (const value of [undefined, 'short', 'A'.repeat(43), revoked.session]) {
        const response = await call(value, body);
        assert.equal(response.status, 401, String(value));
        assert.deepEqual(await response.json(), { error: 'unauthorized' });
      }
      assert.notEqual(await authenticateSession(db, session, NOW), null);
      assert.deepEqual(await counts(), { users: 2, identities: 2, sessions: 1, used_nonces: 0 });
      assert.deepEqual(appleCalls, []);
    });

    it('期限切れのセッションは 401', async () => {
      const { session } = await signedIn();
      const { body } = await appleNative();
      assert.equal((await call(session, body, { now: NOW + 91 * 24 * 60 * 60 * 1000 })).status, 401);
    });

    it('本文の不備は 400（形の組み合わせが違う・nonce が無い・コードの形が違う・Web経由の本文）', async () => {
      const { session } = await signedIn();
      const t = await issueT();
      const idToken = await signToken(t);
      const v = 'B'.repeat(43);
      for (const body of [
        {},
        { provider: 'apple' },
        { provider: 'apple', nonce: t },
        { provider: 'facebook', nonce: t, idToken },
        { provider: 'apple', idToken }, // nonce が無い
        { provider: 'apple', nonce: t, idToken, authorizationCode: 5 },
        { provider: 'apple', nonce: t, idToken, authorizationCode: '' },
        { provider: 'apple', nonce: t, idToken, authorizationCode: 'has space' },
        { provider: 'apple', nonce: t, idToken, authorizationCode: 'x'.repeat(1025) },
        // AndroidのAppleログイン（Web経由）の本文は、まだ受け付けない（それを足すまで、その経路でログインする人もいない）。
        { provider: 'apple', nonce: t, code: 'c', verifier: v },
        { provider: 'apple', nonce: t, idToken, code: 'c', verifier: v },
        { provider: 'google', nonce: t },
        { provider: 'google', nonce: t, idToken, code: 'c' },
        { provider: 'google', nonce: t, idToken, authorizationCode: 'x' },
        { provider: 'google', nonce: 5, idToken },
        '[]',
        'not json',
      ]) {
        const response = await call(session, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.deepEqual(await response.json(), { error: 'invalid_request' });
      }
      assert.deepEqual(await counts(), { users: 1, identities: 1, sessions: 1, used_nonces: 0 });
      assert.deepEqual(appleCalls, []);
    });

    it('本文が大きすぎると 413。POST 以外は 405', async () => {
      const { session } = await signedIn();
      assert.equal((await call(session, JSON.stringify({ provider: 'apple', nonce: 'x', idToken: 'y'.repeat(11_000) }))).status, 413);
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await call(session, {}, { method });
        assert.equal(response.status, 405, method);
        assert.equal(response.headers.get('allow'), 'POST');
      }
      assert.notEqual(await authenticateSession(db, session, NOW), null);
    });

    it('入口（worker.fetch）から届く。HTTPSでなければ 403', async () => {
      const post = (url: string) => worker.fetch(new Request(url, { method: 'POST', body: '{}' }), env);
      assert.equal((await post('https://example.test/auth/delete')).status, 401);
      assert.equal((await post('http://example.test/auth/delete')).status, 403);
    });
  });
});
