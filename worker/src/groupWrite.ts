// グループ内データの書き込みの競合制御。設計は docs/backend-design.md 8章。
//
// D1には対話的トランザクションがなく、`batch()` 単位でのみアトミック。そこで、グループ単位の
// 楽観ロック（expense_groups.data_version と write_token）で、同時に書いた別のリクエストを検出する。
//
// 1. 呼び出し側が data_version（v）を読み、そのあとで検証と計算に使うデータを読む（順序は下の注意）。
// 2. このファイルの writeToGroup が、batch の最初に `data_version = v` のときだけバージョンを上げて
//    リクエスト固有の token を書く。
// 3. 後続のSQLは、`expense_groups.write_token` が自分の token と一致するときだけ効くようにする
//    （GROUP_WRITE_GUARD を使う）。
//
// 注意1: バージョンは、計算に使うデータより「先に」読む。データを先に読み、あとでバージョンを読むと、
// その間に入った別の書き込みの新しいバージョンと、古いデータを組み合わせてしまう。楽観ロックは通るので、
// 別のリクエストの更新を黙って上書きする（lost update）。先にバージョンを読めば、間に書き込みが入った
// 場合はバージョンが合わず、競合として検出される（test/groupWrite.test.ts の「読む順序」）。
//
// 注意2: 後続の条件を `data_version = v + 1` に「簡略化」してはいけない。同じ v を読んだ別のリクエストが
// 先に確定すると、バージョンは v + 1 になっているため、負けた側の後続SQLまで実行されてしまう
// （test/groupWrite.test.ts の「簡略化した条件では…」が、その実例）。
//
// 注意3: 1つのグループへの書き込み用。複数のグループにまたがる書き込み（アカウント削除）は、下の
// `writeToGroups`（docs/backend-design.md 8章）。

/**
 * 後続のSQLに付ける条件のSELECT。`WHERE EXISTS (${GROUP_WRITE_GUARD})` の形で使い、
 * バインドは (groupId, token) の順。INSERTは `INSERT ... SELECT ... WHERE EXISTS (...)`、
 * UPDATE・DELETEは `... AND EXISTS (...)` にする。
 */
export const GROUP_WRITE_GUARD = 'SELECT 1 FROM expense_groups WHERE id = ? AND write_token = ?';

export type GroupWriteResult =
  /** 書き込めた。results は、バージョンを上げるSQLを除いた、build が返したSQLの結果（順番どおり）。 */
  | { ok: true; token: string; results: D1Result[] }
  /**
   * バージョンが合わない。他のリクエストが先に書いた（グループが無い場合も、ここに来る）。
   * 何も変更されていない。読み直してやり直せる。やり直すか409にするかは呼び出し側が決める（8章）。
   */
  | { ok: false; reason: 'version' }
  /**
   * 一意制約に違反した（二重締め、すでに参加している、固定費の作成済み、など）。batch 全体（バージョンの
   * 更新も含む）が取り消され、何も変更されていない。バージョンは合っていた（合っていなければ、後続のSQLは
   * 実行されず、一意制約には触れない）ので、読み直しても同じ結果になる。やり直さない。
   * 業務上どう扱うか（APIなら409、Cronの固定費なら作成済みとして正常）は、呼び出し側が決める。
   */
  | { ok: false; reason: 'unique' };

/** D1の、1つの文に束縛できる値の上限。 */
const MAX_BOUND_PARAMETERS = 100;

/** `insertRowsGuarded` が、1つの文に入れる行数（束縛の上限から、条件の2つ分を引いて、列の数で割る）。 */
export function rowsPerStatement(columnCount: number): number {
  return Math.floor((MAX_BOUND_PARAMETERS - 2) / columnCount);
}

/** `insertRowsGuarded` が作る文の数（行が無ければ0）。書く文の数を、書く前に見積もるのに使う。 */
export function statementsForRows(columnCount: number, rowCount: number): number {
  return Math.ceil(rowCount / rowsPerStatement(columnCount));
}

/**
 * 同じ表への複数行のINSERT。GROUP_WRITE_GUARD の条件つき。月締めのように行数が多い書き込みは、文の数を抑えるため、
 * 束縛の上限（100）に収まる範囲で、複数行を1文にまとめる。D1のクエリ数の上限（Freeは1回の呼び出しにつき50）は、公式は batch を
 * 1回と数えると書くが、本番のFreeで確かめるまでは、batch の1文も1クエリとして見積もる（docs/backend-design.md 8章の
 * 「D1のクエリ数の数え方」）。どちらの数え方でも、この関数は消さない。`rows` の各行は `columns` と同じ順の値。行が無ければ、文も作らない。
 */
export function insertRowsGuarded(
  db: D1Database,
  token: string,
  groupId: string,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): D1PreparedStatement[] {
  const perStatement = rowsPerStatement(columns.length);
  // 1行も入らない列数だと、下のループが進まなくなる。
  if (perStatement < 1) throw new Error(`列が多すぎて、1文に1行も入らない: ${table}（${columns.length}列）`);
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const selected = columns.map((_, index) => `column${index + 1}`).join(', ');
    statements.push(
      db
        .prepare(
          `INSERT INTO ${table} (${columns.join(', ')})
           SELECT ${selected} FROM (VALUES ${chunk.map(() => placeholders).join(', ')})
            WHERE EXISTS (${GROUP_WRITE_GUARD})`,
        )
        .bind(...chunk.flat(), groupId, token),
    );
  }
  return statements;
}

/**
 * グループの現在の data_version。グループが無ければ null。
 * 書き込みに使うデータを読む「前に」呼ぶこと（ファイル冒頭の注意1）。
 */
export async function readDataVersion(db: D1Database, groupId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT data_version FROM expense_groups WHERE id = ?')
    .bind(groupId)
    .first<{ data_version: number }>();
  return row === null ? null : row.data_version;
}

/**
 * グループ内のデータを、`expectedVersion` を読んだ時点から変わっていないときだけ書き込む。
 * `expectedVersion` は、検証・計算に使うデータより先に読んだもの（ファイル冒頭の注意1）。
 *
 * @param build リクエスト固有の token を受け取り、書き込みのSQLを返す。各SQLは GROUP_WRITE_GUARD の
 *   条件を付けること（付け忘れたSQLは、競合しても実行されてしまう）。
 */
export async function writeToGroup(
  db: D1Database,
  groupId: string,
  expectedVersion: number,
  build: (token: string) => D1PreparedStatement[],
): Promise<GroupWriteResult> {
  const token = crypto.randomUUID();
  const bump = db
    .prepare(
      `UPDATE expense_groups SET data_version = data_version + 1, write_token = ?
        WHERE id = ? AND data_version = ?`,
    )
    .bind(token, groupId, expectedVersion);

  let results: D1Result[];
  try {
    results = await db.batch([bump, ...build(token)]);
  } catch (error) {
    // 一意制約違反は、batch 全体がロールバックされる。バージョンの競合とは区別して返す。
    // それ以外（CHECK・外部キー違反など）は実装の誤りなので、握りつぶさずに投げる。
    if (isUniqueViolation(error)) return { ok: false, reason: 'unique' };
    throw error;
  }

  // 0件なら、他のリクエストが先に書いている。後続のSQLも条件を満たさず、何も変更されていない。
  if (results[0].meta.changes === 0) return { ok: false, reason: 'version' };
  return { ok: true, token, results: results.slice(1) };
}

/** `writeToGroups` に渡す、グループと、そのグループについて読んだバージョン。 */
export interface GroupVersion {
  groupId: string;
  expectedVersion: number;
}

/**
 * 複数のグループにまたがる書き込み（アカウント削除。docs/backend-design.md 5章・8章）。
 *
 * 1文の UPDATE で、**すべてのグループ**の `data_version` が読んだときのままのときだけ、全グループのバージョンを上げて、
 * 同じ token を書く（1つでも合わなければ、どのグループも変えない）。後続のSQLは、`writeToGroup` と同じ
 * GROUP_WRITE_GUARD を、自分のグループの token に対して付ける。token を書くのは、この1文だけで、全グループか、
 * どのグループにも書かれないかのどちらかなので、1つのグループの条件だけで、全グループが揃っていることになる。
 * （グループごとに別々のUPDATEにすると、一部のグループだけ書き込めた状態が残る。8章）
 *
 * - グループ・バージョンは、`json_each` の1つの束縛で渡す（束縛の上限100を、グループの数に制限されないため）。
 * - `extraCondition`: バージョンを上げる文の WHERE に足す条件（`AND` でつなぐ。プレースホルダーは `?` で、`bindings` の
 *   順）。アカウント削除は、「読んだあとに、新しいグループのメンバーになっていない」ことを、ここで確かめる。
 * - `build` は、token を受け取り、書き込みのSQLを返す。各SQLに GROUP_WRITE_GUARD を付けること。**グループ自体
 *   （`expense_groups` の行）を消す文は、最後にまとめる**（途中で消すと、そのグループの token の条件で、後続の文が
 *   効かなくなる）。
 * - `groups` は、重複しないこと。空は不可（書くグループが無ければ、このAPIは要らない）。
 */
export async function writeToGroups(
  db: D1Database,
  groups: readonly GroupVersion[],
  build: (token: string) => D1PreparedStatement[],
  extraCondition: { sql: string; bindings: readonly (string | number)[] } | null = null,
): Promise<GroupWriteResult> {
  if (groups.length === 0) throw new Error('書くグループが無い');
  if (new Set(groups.map((group) => group.groupId)).size !== groups.length) throw new Error('グループが重複している');
  const token = crypto.randomUUID();
  const versions = JSON.stringify(groups.map((group) => ({ id: group.groupId, v: group.expectedVersion })));
  const bump = db
    .prepare(
      `UPDATE expense_groups SET data_version = data_version + 1, write_token = ?
        WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
          AND (SELECT count(*) FROM expense_groups g JOIN json_each(?) j
                ON g.id = json_extract(j.value, '$.id') AND g.data_version = json_extract(j.value, '$.v')) = ?
          ${extraCondition === null ? '' : `AND ${extraCondition.sql}`}`,
    )
    .bind(token, versions, versions, groups.length, ...(extraCondition?.bindings ?? []));

  let results: D1Result[];
  try {
    results = await db.batch([bump, ...build(token)]);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'unique' };
    throw error;
  }
  // 全グループに効いていなければ、1つも書かれていない（後続のSQLも、条件を満たさず、何も変更していない）。
  if (results[0].meta.changes !== groups.length) return { ok: false, reason: 'version' };
  return { ok: true, token, results: results.slice(1) };
}

/** `writeToGroupWithRetry` の `plan` の結果。書くか、書かずに断るか。 */
export type GroupWritePlan<T, R> =
  /** 書く。`write` は writeToGroup の build と同じ（各SQLに GROUP_WRITE_GUARD を付ける）。`value` は成功時にそのまま返す。 */
  | { write: (token: string) => D1PreparedStatement[]; value: T }
  /** 書かずに断る（検証に通らなかった、など）。`reject` はそのまま返す。 */
  | { reject: R };

export type GroupWriteOutcome<T, R> =
  | { status: 'written'; value: T }
  | { status: 'rejected'; reject: R }
  /** グループが無い（バージョンを読めなかった）。 */
  | { status: 'no_group' }
  /** やり直しても競合した（'version'）、または一意制約に違反した（'unique'。やり直さない）。何も変更されていない。 */
  | { status: 'conflict'; reason: 'version' | 'unique' };

/**
 * 「読み直して1回だけやり直す」書き込み（支出の登録・編集・削除、割合の変更など。docs/backend-design.md 8章
 * 「競合したとき」）。やり直さずに409にする操作（月締め・精算・繰越・参加・脱退）は、writeToGroup を直接使う。
 *
 * 試行ごとに、バージョンを読み、その**あとで** `plan` が検証用のデータを読んで、書くSQLを組み立てる
 * （ファイル冒頭の注意1。`plan` の中で読むデータは、必ず渡されたバージョンのあとに読む）。
 * 'version' はやり直す（`maxAttempts` 回まで）。'unique' は読み直しても同じ結果なので、やり直さない。
 */
export async function writeToGroupWithRetry<T, R>(
  db: D1Database,
  groupId: string,
  plan: (version: number) => Promise<GroupWritePlan<T, R>>,
  maxAttempts = 2,
): Promise<GroupWriteOutcome<T, R>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const version = await readDataVersion(db, groupId);
    if (version === null) return { status: 'no_group' };
    const planned = await plan(version);
    if ('reject' in planned) return { status: 'rejected', reject: planned.reject };
    const result = await writeToGroup(db, groupId, version, planned.write);
    if (result.ok) return { status: 'written', value: planned.value };
    if (result.reason === 'unique') return { status: 'conflict', reason: 'unique' };
  }
  return { status: 'conflict', reason: 'version' };
}

/**
 * 一意制約違反（主キーの重複を含む）かどうか。判定はエラーのメッセージ頼み。
 *
 * D1のエラーは、`D1_ERROR: UNIQUE constraint failed: <表>.<列>: SQLITE_CONSTRAINT ...` という
 * メッセージで届き、SQLiteの元のメッセージが `cause` にも入る（ローカルD1で確認。本番D1も同じ形かは、
 * 公開前に確認する。docs/backend-design.md 13章の9）。どちらに入っていても拾えるよう、`cause` をたどる。
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    const message = typeof current === 'string' ? current : current instanceof Error ? current.message : '';
    if (/UNIQUE constraint failed/i.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
