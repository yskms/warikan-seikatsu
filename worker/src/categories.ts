// 費目（一覧・作成・変更・アーカイブ・並べ替え）と、月ごとの負担割合（取得・変更）。形と規則は
// docs/backend-design.md 9章「費目・負担割合」、割合の持ち方は同3章「月ごとの負担割合」。
//
// 書き込みは、すべて writeToGroupWithRetry を通す（8章）: バージョンを先に読み、そのあとで検証に使うデータを読む。
// 読み込みは `plan` の中だけで行う。書くSQLは、すべて GROUP_WRITE_GUARD の条件つき。
//
// 費目を作るときは、必ず、月の設定（`category_month_settings`）と割合（`category_month_shares`）を書く。無いと、その費目の
// `category` の支出が月にあるときに、集計できずに500になる（付録A-7）。
import {
  authenticateRequest,
  canEditGroupSettings,
  canViewMonth,
  isMonthClosed,
  latestClosedMonth,
  loadGroupAccess,
  type GroupAccess,
} from './access.ts';
import {
  parseCategoryOrder,
  parseCategoryRule,
  parseCreateCategory,
  parseResetAcknowledgement,
  parseUpdateCategory,
  type CategoryRuleInput,
} from './categoryInput.ts';
import { GROUP_WRITE_GUARD, insertRowsGuarded, writeToGroupWithRetry } from './groupWrite.ts';
import {
  conflict,
  forbidden,
  invalidRequest,
  json,
  noContent,
  notFound,
  readJsonObject,
  unauthorized,
} from './http.ts';
import { MAX_CATEGORIES_PER_GROUP } from './limits.ts';
import {
  loadMembers,
  loadRuleMonthsAfter,
  monthsToReset,
  participantIds,
} from './membership.ts';
import { monthIn, registerableRange } from './months.ts';
import { allocateEqually, BASIS_POINTS_TOTAL } from './settlement.ts';
import type { MemberInfo } from './monthState.ts';

const MAX_BODY_BYTES = 4 * 1024;

interface CategoryRow {
  id: string;
  group_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  archived_at: number | null;
  created_at: number;
}

const CATEGORY_COLUMNS = 'id, group_id, name, icon, color, sort_order, archived_at, created_at';

function categoryJson(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    // アーカイブした日時。新しい支出では選べなくなる（過去の支出は残る）。
    archivedAt: row.archived_at,
  };
}
type CategoryJson = ReturnType<typeof categoryJson>;

async function loadCategory(db: D1Database, groupId: string, categoryId: string): Promise<CategoryRow | null> {
  return db
    .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ? AND group_id = ?`)
    .bind(categoryId, groupId)
    .first<CategoryRow>();
}

async function loadCategories(db: D1Database, groupId: string): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE group_id = ? ORDER BY sort_order, id`)
    .bind(groupId)
    .all<CategoryRow>();
  return results;
}

/** 書き込みの結果の共通の返し方（`writeToGroupWithRetry` の `rejected` は、そのまま返す）。 */
function writeFailure(outcome: { status: 'rejected'; reject: Response } | { status: 'no_group' } | { status: 'conflict' }): Response {
  switch (outcome.status) {
    case 'rejected':
      return outcome.reject;
    case 'no_group':
      return notFound();
    default:
      return conflict('conflict');
  }
}

// ---------------------------------------------------------------------------
// GET /groups/:id/categories

export async function handleListCategories(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const access = await loadGroupAccess(env.DB, session.userId, groupId);
  if (access === null) return notFound();
  const categories = await loadCategories(env.DB, groupId);
  // アーカイブした費目も返す（過去の支出の表示に要る）。支出の登録画面で選べるのは、`archivedAt` が null のもの。
  return json({ categories: categories.map(categoryJson) });
}

// ---------------------------------------------------------------------------
// POST /groups/:id/categories

/**
 * 新しい費目の、月ごとの割合の行。`months` の月それぞれに、その月に参加しているメンバーでの均等割り・上限額なしの行を書く
 * （3章「費目を作ったとき」）。この費目だけの行を書く（`resetSharesStatements` は全費目の行を消すので使わない）。
 */
function newCategoryRuleStatements(
  db: D1Database,
  token: string,
  groupId: string,
  categoryId: string,
  members: readonly MemberInfo[],
  months: readonly string[],
): D1PreparedStatement[] {
  const settings: (string | number | null)[][] = [];
  const shares: (string | number | null)[][] = [];
  for (const month of months) {
    const memberIds = participantIds(members, month);
    // その月に参加しているメンバーがいなければ、行は書かない（その月は、前の月の設定を引き継ぐ。集計に入る人がいない月）。
    if (memberIds.length === 0) continue;
    settings.push([groupId, categoryId, month, null, null]);
    for (const share of allocateEqually(BASIS_POINTS_TOTAL, memberIds)) {
      shares.push([groupId, categoryId, month, share.memberId, share.amount]);
    }
  }
  return [
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_settings',
      ['group_id', 'category_id', 'target_month', 'cap_member_id', 'cap_minor'],
      settings,
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_shares',
      ['group_id', 'category_id', 'target_month', 'member_id', 'share_basis_points'],
      shares,
    ),
  ];
}

export async function handleCreateCategory(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseCreateCategory(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const input = parsed.value;
  const db = env.DB;

  // やり直しても同じ費目になるよう、IDは試行の外で決める。
  const categoryId = input.id ?? crypto.randomUUID();

  const outcome = await writeToGroupWithRetry<CategoryJson, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };

    // 同じ `id` の作成の再送（通信が途切れて、成功したか分からなかった）。保存済みの費目を返す。別のグループが使っている
    // IDなら、中身を返さずに競合とする（支出の登録と同じ。9章の支出API「二重送信」）。
    if (input.id !== null) {
      const existing = await db
        .prepare(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`)
        .bind(input.id)
        .first<CategoryRow>();
      if (existing !== null) {
        return { reject: existing.group_id === groupId ? json({ category: categoryJson(existing) }) : conflict('conflict') };
      }
    }

    const [stats, members, closedThrough] = await Promise.all([
      db
        .prepare('SELECT count(*) AS n, coalesce(max(sort_order), -1) AS max_order FROM categories WHERE group_id = ?')
        .bind(groupId)
        .first<{ n: number; max_order: number }>(),
      loadMembers(db, groupId),
      latestClosedMonth(db, groupId),
    ]);
    if ((stats?.n ?? 0) >= MAX_CATEGORIES_PER_GROUP) return { reject: conflict('too_many_categories') };
    const sortOrder = (stats?.max_order ?? -1) + 1;

    // 割合の行を書く月: 最初の未締めの月と、それより後で、割合の行がある月。後の月の行は、その月以前で最も新しい行の
    // 引き継ぎを上書きしている（メンバーの増減で書かれる。5章）ので、新しい費目にも、その月のメンバーでの行が要る。
    // 書かないと、後の月が、最初の未締めの月の割合（脱退・削除したメンバーを含む）を引き継いでしまう。
    const { from } = registerableRange({
      createdMonth: monthIn(access.group.timezone, access.group.createdAt),
      currentMonth: monthIn(access.group.timezone, now),
      latestClosedMonth: closedThrough,
    });
    const ruleMonths = await loadRuleMonthsAfter(db, groupId, closedThrough);
    const months = monthsToReset([from], ruleMonths);

    const row: CategoryRow = {
      id: categoryId,
      group_id: groupId,
      name: input.name,
      icon: input.icon,
      color: input.color,
      sort_order: sortOrder,
      archived_at: null,
      created_at: now,
    };
    return {
      write: (token: string) => [
        ...insertRowsGuarded(
          db,
          token,
          groupId,
          'categories',
          ['id', 'group_id', 'name', 'icon', 'color', 'sort_order', 'created_at'],
          [[row.id, groupId, row.name, row.icon, row.color, row.sort_order, now]],
        ),
        ...newCategoryRuleStatements(db, token, groupId, categoryId, members, months),
      ],
      value: categoryJson(row),
    };
  });
  if (outcome.status === 'written') return json({ category: outcome.value }, 201);
  return writeFailure(outcome);
}

// ---------------------------------------------------------------------------
// PATCH /categories/:id

export async function handleUpdateCategory(
  request: Request,
  env: Env,
  now: number,
  categoryId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseUpdateCategory(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const patch = parsed.value;
  const db = env.DB;

  const owner = await db
    .prepare('SELECT group_id FROM categories WHERE id = ?')
    .bind(categoryId)
    .first<{ group_id: string }>();
  if (owner === null) return notFound();
  const groupId = owner.group_id;

  const outcome = await writeToGroupWithRetry<CategoryJson, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    const current = await loadCategory(db, groupId, categoryId);
    if (current === null) return { reject: notFound() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };

    const next: CategoryRow = {
      ...current,
      name: patch.name ?? current.name,
      icon: patch.icon ?? current.icon,
      color: patch.color ?? current.color,
      // すでにアーカイブしていれば、日時はそのまま。戻すと null。
      archived_at:
        patch.archived === undefined ? current.archived_at : patch.archived ? (current.archived_at ?? now) : null,
    };
    // 変わるものが無ければ、書かずに、いまの状態を返す(バージョンを上げない)。
    if (
      next.name === current.name &&
      next.icon === current.icon &&
      next.color === current.color &&
      next.archived_at === current.archived_at
    ) {
      return { reject: json({ category: categoryJson(current) }) };
    }
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE categories SET name = ?, icon = ?, color = ?, archived_at = ?
              WHERE id = ? AND group_id = ? AND EXISTS (${GROUP_WRITE_GUARD})`,
          )
          .bind(next.name, next.icon, next.color, next.archived_at, categoryId, groupId, groupId, token),
      ],
      value: categoryJson(next),
    };
  });
  if (outcome.status === 'written') return json({ category: outcome.value });
  return writeFailure(outcome);
}

// ---------------------------------------------------------------------------
// PUT /groups/:id/categories/order

export async function handleReorderCategories(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseCategoryOrder(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const orderedIds = parsed.value;
  const db = env.DB;

  const outcome = await writeToGroupWithRetry<CategoryJson[], Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };
    const current = await loadCategories(db, groupId);
    // 全費目（アーカイブ済みも含む）を並べ替える。読んだあとに費目が増えた・知らないIDがあるときは、読み直してもらう。
    const known = new Set(current.map((row) => row.id));
    if (known.size !== orderedIds.length || !orderedIds.every((id) => known.has(id))) {
      return { reject: conflict('categories_changed') };
    }
    const order = JSON.stringify(orderedIds.map((id, index) => ({ id, o: index })));
    const byId = new Map(current.map((row) => [row.id, row]));
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE categories
                SET sort_order = (SELECT json_extract(j.value, '$.o') FROM json_each(?) j
                                   WHERE json_extract(j.value, '$.id') = categories.id)
              WHERE group_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
                AND EXISTS (${GROUP_WRITE_GUARD})`,
          )
          .bind(order, groupId, order, groupId, token),
      ],
      value: orderedIds.map((id, index) => categoryJson({ ...byId.get(id)!, sort_order: index })),
    };
  });
  if (outcome.status === 'written') return json({ categories: outcome.value });
  return writeFailure(outcome);
}

// ---------------------------------------------------------------------------
// 月ごとの負担割合

/** 割合を直せる月の範囲。登録できる月と同じ（8章・12章）。今月を締めていれば翌月だけ。 */
async function editableMonths(db: D1Database, access: GroupAccess, now: number): Promise<{ from: string; to: string }> {
  return registerableRange({
    createdMonth: monthIn(access.group.timezone, access.group.createdAt),
    currentMonth: monthIn(access.group.timezone, now),
    latestClosedMonth: await latestClosedMonth(db, access.group.id),
  });
}

interface RuleJson {
  categoryId: string;
  /** この割合が書かれている月。その月以前で最も新しい行（3章。行が無い月は、前の月を引き継ぐ）。 */
  sourceMonth: string;
  shares: { memberId: string; basisPoints: number }[];
  cap: { memberId: string; capMinor: number } | null;
  /**
   * メンバーの増減で、この割合を均等に戻した時刻（Unixエポックのミリ秒）。まだ誰も見直していなければ入る。見直した
   * （割合を保存した、または見直しの確認をした）ら null。ホームのお知らせ「メンバーが増減した」の元（5章の「参加」・12章）。
   */
  memberChangedAt: number | null;
}

/** 費目ごとの、その月の割合（その月以前で最も新しい月の行）。割合が1つも無い費目（作る前の月）は含めない。 */
async function loadRules(
  db: D1Database,
  groupId: string,
  month: string,
): Promise<{ category: CategoryRow; rule: RuleJson }[]> {
  const currentRule = `(SELECT max(target_month) FROM category_month_settings WHERE category_id = c.id AND target_month <= ?2)`;
  const [settings, shares] = await db.batch([
    db
      .prepare(
        `SELECT c.id AS id, c.group_id AS group_id, c.name AS name, c.icon AS icon, c.color AS color,
                c.sort_order AS sort_order, c.archived_at AS archived_at, c.created_at AS created_at,
                s.target_month AS source_month, s.cap_member_id AS cap_member_id, s.cap_minor AS cap_minor,
                s.member_changed_at AS member_changed_at
           FROM categories c
           JOIN category_month_settings s ON s.category_id = c.id AND s.target_month = ${currentRule}
          WHERE c.group_id = ?1 ORDER BY c.sort_order, c.id`,
      )
      .bind(groupId, month),
    db
      .prepare(
        `SELECT sh.category_id AS category_id, sh.member_id AS member_id, sh.share_basis_points AS share_basis_points
           FROM categories c
           JOIN category_month_settings s ON s.category_id = c.id AND s.target_month = ${currentRule}
           JOIN category_month_shares sh ON sh.category_id = s.category_id AND sh.target_month = s.target_month
          WHERE c.group_id = ?1 ORDER BY sh.member_id`,
      )
      .bind(groupId, month),
  ]);
  const sharesByCategory = new Map<string, RuleJson['shares']>();
  for (const row of shares.results as { category_id: string; member_id: string; share_basis_points: number }[]) {
    const list = sharesByCategory.get(row.category_id) ?? [];
    list.push({ memberId: row.member_id, basisPoints: row.share_basis_points });
    sharesByCategory.set(row.category_id, list);
  }
  return (
    settings.results as unknown as (CategoryRow & {
      source_month: string;
      cap_member_id: string | null;
      cap_minor: number | null;
      member_changed_at: number | null;
    })[]
  ).map((row) => ({
    category: row,
    rule: {
      categoryId: row.id,
      sourceMonth: row.source_month,
      shares: sharesByCategory.get(row.id) ?? [],
      cap: row.cap_member_id === null ? null : { memberId: row.cap_member_id, capMinor: row.cap_minor! },
      memberChangedAt: row.member_changed_at,
    },
  }));
}

// GET /groups/:id/months/:month/category-shares

export async function handleGetCategoryRules(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
  month: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;
  const access = await loadGroupAccess(db, session.userId, groupId);
  if (access === null) return notFound();
  // 新しいメンバーが見られるのは、参加（復帰）した月以降（5章）。
  if (!canViewMonth(access, month)) return forbidden();

  const [rules, members, closed, range] = await Promise.all([
    loadRules(db, groupId, month),
    loadMembers(db, groupId),
    isMonthClosed(db, groupId, month),
    editableMonths(db, access, now),
  ]);
  return json({
    month,
    closed,
    // 画面が、保存の入口を出すか。締めた月は変わらない。直せる月は登録できる月と同じ。
    editable: !closed && month >= range.from && month <= range.to && canEditGroupSettings(access, now),
    // この月の割合に入るメンバー（割合を直すときは、この全員を、合計10000で送る。3章）。
    memberIds: participantIds(members, month).sort(),
    categories: rules.map(({ category, rule }) => ({
      ...rule,
      archived: category.archived_at !== null,
    })),
  });
}

// PUT /groups/:id/months/:month/category-shares/:categoryId

export async function handlePutCategoryRule(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
  month: string,
  categoryId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseCategoryRule(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const input: CategoryRuleInput = parsed.value;
  const db = env.DB;

  const outcome = await writeToGroupWithRetry<{ overriddenMonths: string[] }, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    if (!canViewMonth(access, month)) return { reject: forbidden() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };
    // 上限額は通貨の最小単位の整数。通貨を変えた直後に、古い通貨の画面から送られた額を、別の額として保存しない。
    if (input.currencyCode !== null && input.currencyCode !== access.group.currencyCode) {
      return { reject: conflict('currency_mismatch', { currencyCode: access.group.currencyCode }) };
    }
    const [category, closed, range, members, later] = await Promise.all([
      loadCategory(db, groupId, categoryId),
      isMonthClosed(db, groupId, month),
      editableMonths(db, access, now),
      loadMembers(db, groupId),
      db
        .prepare(
          `SELECT target_month FROM category_month_settings
            WHERE category_id = ? AND target_month > ? ORDER BY target_month`,
        )
        .bind(categoryId, month)
        .all<{ target_month: string }>(),
    ]);
    if (category === null) return { reject: notFound() };
    // 締めた月の割合は確定している（4章）。
    if (closed) return { reject: conflict('month_closed') };
    if (month < range.from || month > range.to) return { reject: conflict('month_not_editable', { from: range.from, to: range.to }) };

    // 行は、その月に負担対象となる全メンバーの組として書く（3章）。メンバーが増減した（読んだ画面が古い）ときは、
    // 読み直してもらう。削除したユーザーも、削除した月までは組に入る（外したいときは0%にする。5章）。
    const required = participantIds(members, month).sort();
    const sent = input.shares.map((share) => share.memberId).sort();
    if (required.length !== sent.length || required.some((id, index) => id !== sent[index])) {
      return { reject: conflict('members_changed', { memberIds: required }) };
    }

    const settings = (token: string) =>
      insertRowsGuarded(
        db,
        token,
        groupId,
        'category_month_settings',
        ['group_id', 'category_id', 'target_month', 'cap_member_id', 'cap_minor'],
        [[groupId, categoryId, month, input.cap?.memberId ?? null, input.cap?.capMinor ?? null]],
      );
    const remove = (token: string, table: string) =>
      db
        .prepare(
          `DELETE FROM ${table} WHERE group_id = ? AND category_id = ? AND target_month = ? AND EXISTS (${GROUP_WRITE_GUARD})`,
        )
        .bind(groupId, categoryId, month, groupId, token);
    return {
      write: (token: string) => [
        remove(token, 'category_month_shares'),
        remove(token, 'category_month_settings'),
        ...settings(token),
        ...insertRowsGuarded(
          db,
          token,
          groupId,
          'category_month_shares',
          ['group_id', 'category_id', 'target_month', 'member_id', 'share_basis_points'],
          input.shares.map((share) => [groupId, categoryId, month, share.memberId, share.basisPoints]),
        ),
      ],
      // この月より後に、別の設定の行がある月。その月は、この変更を引き継がない（メンバーの増減で書いた行を、上書きしない）。
      value: { overriddenMonths: later.results.map((row) => row.target_month) },
    };
  });
  if (outcome.status !== 'written') return writeFailure(outcome);
  return json({
    month,
    rule: {
      categoryId,
      sourceMonth: month,
      shares: [...input.shares].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
      cap: input.cap,
      // 保存した行は書き直すので、見直しの印は消える（`member_changed_at` を入れない）。
      memberChangedAt: null,
    },
    overriddenMonths: outcome.value.overriddenMonths,
  });
}

// POST /groups/:id/category-shares/acknowledge-reset

/**
 * 「メンバーが変わったため、割合を均等に戻した」お知らせを、見直し済みにする（`member_changed_at` の印を一括で消す）。
 * 割合は変えない。ホームのお知らせの「確認した」。形は9章の「費目・負担割合API」。
 *
 * 本文の `through` は、アプリが見た最も新しい印の時刻。それより新しい印（確認を押すまでに、別のメンバーの参加などで、
 * 割合を戻したもの）は、見ていないので消さない。同じ確認を何度送っても同じ（印が無ければ何も変わらない）ので、
 * 競合は、読み直して1回やり直してよい（`writeToGroupWithRetry`）。
 */
export async function handleAcknowledgeSharesReset(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const body = await readJsonObject(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseResetAcknowledgement(body.body);
  if (!parsed.ok) return invalidRequest(parsed.field === '' ? undefined : parsed.field);
  const through = parsed.value;
  const db = env.DB;

  const outcome = await writeToGroupWithRetry<null, Response>(db, groupId, async () => {
    const access = await loadGroupAccess(db, session.userId, groupId);
    if (access === null) return { reject: notFound() };
    if (!canEditGroupSettings(access, now)) return { reject: forbidden() };
    return {
      write: (token: string) => [
        db
          .prepare(
            `UPDATE category_month_settings SET member_changed_at = NULL
              WHERE group_id = ? AND member_changed_at IS NOT NULL AND member_changed_at <= ? AND EXISTS (${GROUP_WRITE_GUARD})`,
          )
          .bind(groupId, through, groupId, token),
      ],
      value: null,
    };
  });
  return outcome.status === 'written' ? noContent() : writeFailure(outcome);
}
