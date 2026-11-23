// 月次集計・月締め・精算のAPIのテストで使う、呼び出しの道具。
import { handleCloseMonth, handleGetClosing, handleMonthSummary } from '../src/closings.ts';
import { handleListMonths } from '../src/monthList.ts';
import { handleProcessTransfer } from '../src/transfers.ts';
import { NOW, type Person } from './apiFixture.ts';

export interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** 2026-12-19 12:00（Asia/Tokyo）。11月が終わったあとの「いま」。 */
export const NOW_DECEMBER = Date.UTC(2026, 11, 19, 3, 0, 0);
/** 2027-01-19 12:00（Asia/Tokyo）。 */
export const NOW_JANUARY = Date.UTC(2027, 0, 19, 3, 0, 0);

export const request = (method: string, path: string, token: string | null, body?: unknown) =>
  new Request(`https://example.test${path}`, {
    method,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const read = async (response: Response): Promise<ApiResult> => {
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
};

interface Options {
  now?: number;
  env?: Env;
}

/** 各APIの呼び出し。`who` が null なら、セッション無し。 */
export function monthApi(defaultEnv: Env) {
  return {
    months: async (who: Person | null, groupId: string, options: Options = {}) =>
      read(
        await handleListMonths(
          request('GET', `/groups/${groupId}/months`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          groupId,
        ),
      ),
    summary: async (who: Person | null, groupId: string, month: string, options: Options = {}) =>
      read(
        await handleMonthSummary(
          request('GET', `/groups/${groupId}/months/${month}/summary`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          groupId,
          month,
        ),
      ),
    closing: async (who: Person | null, groupId: string, month: string, options: Options = {}) =>
      read(
        await handleGetClosing(
          request('GET', `/groups/${groupId}/months/${month}/closing`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          groupId,
          month,
        ),
      ),
    close: async (who: Person | null, groupId: string, month: string, options: Options = {}) =>
      read(
        await handleCloseMonth(
          request('POST', `/groups/${groupId}/months/${month}/close`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          groupId,
          month,
        ),
      ),
    settle: async (who: Person | null, transferId: string, options: Options = {}) =>
      read(
        await handleProcessTransfer(
          request('POST', `/transfers/${transferId}/settle`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          transferId,
          'settle',
        ),
      ),
    carry: async (who: Person | null, transferId: string, options: Options = {}) =>
      read(
        await handleProcessTransfer(
          request('POST', `/transfers/${transferId}/carry`, who?.token ?? null),
          options.env ?? defaultEnv,
          options.now ?? NOW,
          transferId,
          'carry',
        ),
      ),
  };
}

/**
 * `batch` の直前に、`interference` を `times` 回だけ実行するDB。先頭の `skipBatches` 回の batch は素通しする。
 * 「検証のために読んだあと、書く前に、別のリクエストが書いた」状況を作る。月締めと精算は、状態の読み込みも
 * batch で行う（1回目）ので、書き込みの batch（2回目）の前に割り込むには、`skipBatches: 1` を指定する。
 */
export function interferingEnv(
  env: Env,
  interference: () => Promise<unknown>,
  options: { times?: number; skipBatches?: number } = {},
): Env {
  let skip = options.skipBatches ?? 0;
  let left = options.times ?? 1;
  const proxy = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (skip > 0) {
            skip -= 1;
          } else if (left > 0) {
            left -= 1;
            await interference();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...env, DB: proxy };
}

/**
 * DBに作られた文の数（`prepare` の呼び出し。どの文も1回だけ実行するので、batch の1文も1クエリとして数えたD1のクエリ数と同じ）と、
 * `batch` ごとの文の数を、呼ばれた順に記録するDB。公式は batch を1回と数えると書くが、本番のFreeで確かめるまでは、安全側に1文ずつ
 * 数える（docs/backend-design.md 8章）。Freeは1回の呼び出しにつき50まで。
 * 月締めは、状態の読み込み・書き込み・締め結果の読み込みの順に batch が3回。
 */
export function countingEnv(env: Env): { env: Env; counts: { queries: number; batchSizes: number[] } } {
  const counts = { queries: 0, batchSizes: [] as number[] };
  const proxy = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          counts.queries += 1;
          return target.prepare(sql);
        };
      }
      if (property === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          counts.batchSizes.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { env: { ...env, DB: proxy }, counts };
}
