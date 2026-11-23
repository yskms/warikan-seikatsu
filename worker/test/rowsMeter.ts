// D1の「読んだ行数」「書いた行数」を数えるDB（ローカルD1の `meta.rows_read`・`meta.rows_written`）。
// Freeの日次の上限（読み取り500万行・書き込み10万行。docs/backend-design.md 12章）に対する、1回の操作の費用を測るために使う。
// ローカルD1の `rows_written` は、索引の更新も1行と数える（`test/rowsWritten.test.ts` の冒頭の検査）。本番の課金の数え方と同じはずだが、
// 本番での一致は、確かめていない（docs/backend-design.md 13章の9）。
// `first()` は、`all()` で読んで1行目を返す（`first()` は `meta` を返さないため。読む行数は同じ）。
// `batch` に渡す文は、元の文に戻してから渡す。
export interface RowTotals {
  read: number;
  written: number;
}

export function meteredEnv(env: Env): { env: Env; totals: RowTotals } {
  const totals: RowTotals = { read: 0, written: 0 };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const add = (meta: { rows_read?: number; rows_written?: number }) => {
    totals.read += meta.rows_read ?? 0;
    totals.written += meta.rows_written ?? 0;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'run') {
          return async () => {
            const result = await target.run();
            add(result.meta);
            return result;
          };
        }
        if (property === 'all') {
          return async () => {
            const result = await target.all();
            add(result.meta);
            return result;
          };
        }
        if (property === 'first') {
          return async (column?: string) => {
            const result = await target.all<Record<string, unknown>>();
            add(result.meta);
            const row = result.results[0];
            if (row === undefined) return null;
            return column === undefined ? row : row[column];
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((statement) => originals.get(statement) ?? statement));
          for (const result of results) add(result.meta);
          return results;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { env: { ...env, DB: db }, totals };
}
