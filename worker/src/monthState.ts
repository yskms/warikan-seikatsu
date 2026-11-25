// 月の集計の読み込みと組み立て。summary API と月締めで、同じ読み込み・同じ計算を使う
// （締める前の見込みと、締めた結果がずれないように。docs/backend-design.md 3章・4章）。
//
// 読み込みは1回の batch（同じ時点）で行う。書き込みのために呼ぶときは、先に `readDataVersion` で
// バージョンを読む（groupWrite.ts 冒頭の注意1）。
import { participatesInMonth, type GroupAccess } from './access.ts';
import { monthIn, previousMonth } from './months.ts';
import {
  computeMonth,
  SettlementInputError,
  type CategoryRule,
  type MemberAmount,
  type MemberShare,
  type MonthExpense,
  type MonthResult,
  type Transfer,
} from './settlement.ts';

export interface MemberInfo {
  id: string;
  displayName: string;
  status: 'active' | 'leaving' | 'left' | 'deleted';
  historyFromMonth: string;
  expenseEndMonth: string | null;
  leaveRequestedMonth: string | null;
}

/** 費目の、その月に使う設定（その月以前で最も新しい月の行。3章）。 */
export interface CategoryRuleSource {
  /** どの月の行か。対象の月より前なら、引き継いだもの。 */
  sourceMonth: string;
  /** 費目をアーカイブしているか。月締めで設定を引き継いで書くとき、使っていないアーカイブ済みの費目は書かない。 */
  archived: boolean;
  /** メンバーの増減で割合を戻した時刻（まだ見直されていなければ）。月締めで引き継いで書くとき、そのまま写す。 */
  memberChangedAt: number | null;
  rule: CategoryRule;
}

interface ExpenseSummaryRow {
  id: string;
  amount_minor: number;
  category_id: string;
  payer_member_id: string;
  split_method: 'category' | 'equal' | 'ratio' | 'fixed' | 'single';
}

export interface MonthState {
  members: Map<string, MemberInfo>;
  expenses: ExpenseSummaryRow[];
  /** `category` 以外の支出の確定負担額（支出IDごと）。 */
  allocations: Map<string, MemberAmount[]>;
  /** 費目IDごと。設定が1つも無い費目は入らない。 */
  rules: Map<string, CategoryRuleSource>;
  /** 前の月の締めで繰り越した送金。 */
  carriedIn: Transfer[];
  /** 対象の月と、その前の月の締め（あれば）。 */
  closings: { id: string; month: string }[];
  /** 最後に締めた月。まだ締めていなければ null。 */
  latestClosedMonth: string | null;
  /** 前の月の締めに、未処理（pending）の送金があるか。 */
  previousHasPending: boolean;
  /** 最初の支出がある月。支出が1件も無ければ null。 */
  firstExpenseMonth: string | null;
}

/**
 * 対象の月の集計に必要なものを読む。`closings` は、その月が締め済みかを知るために必ず読む。
 * 締め済みの月では、支出などは使わない（締めた結果を読む。closings.ts）。
 */
export async function loadMonthState(db: D1Database, groupId: string, month: string): Promise<MonthState> {
  // 0000-01 の前の月は無いが、その月は誰も見られない（参加前の月は、呼び出し側が先に断る）ので、ここには来ない。
  const previous = previousMonth(month);
  const previousClosingId = `(SELECT id FROM monthly_closings WHERE group_id = ?1 AND target_month = ?2)`;
  const currentRule = `(SELECT max(target_month) FROM category_month_settings WHERE category_id = c.id AND target_month <= ?2)`;
  const [
    members,
    expenses,
    allocations,
    settings,
    shares,
    closings,
    latest,
    carried,
    pending,
    firstExpense,
  ] = await db.batch([
    db
      .prepare(
        `SELECT id, display_name, status, history_from_month, expense_end_month, leave_requested_month
           FROM group_members WHERE group_id = ?`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT id, amount_minor, category_id, payer_member_id, split_method FROM expenses
          WHERE group_id = ?1 AND target_month = ?2`,
      )
      .bind(groupId, month),
    // 主キー（expense_id, member_id）で引く。グループ全体の負担額を読まない。
    db
      .prepare(
        `SELECT expense_id, member_id, burden_minor FROM expense_allocations
          WHERE group_id = ?1 AND expense_id IN (SELECT id FROM expenses WHERE group_id = ?1 AND target_month = ?2)`,
      )
      .bind(groupId, month),
    // 費目ごとに、その月以前で最も新しい月の設定を、主キーで引く（費目の数だけ。月の数には比例しない）。
    db
      .prepare(
        `SELECT s.category_id AS category_id, s.target_month AS source_month, c.archived_at IS NOT NULL AS archived,
                s.cap_member_id AS cap_member_id, s.cap_minor AS cap_minor, s.member_changed_at AS member_changed_at
           FROM categories c
           JOIN category_month_settings s ON s.category_id = c.id AND s.target_month = ${currentRule}
          WHERE c.group_id = ?1`,
      )
      .bind(groupId, month),
    db
      .prepare(
        `SELECT sh.category_id AS category_id, sh.member_id AS member_id, sh.share_basis_points AS share_basis_points
           FROM categories c
           JOIN category_month_settings s ON s.category_id = c.id AND s.target_month = ${currentRule}
           JOIN category_month_shares sh ON sh.category_id = s.category_id AND sh.target_month = s.target_month
          WHERE c.group_id = ?1`,
      )
      .bind(groupId, month),
    db
      .prepare('SELECT id, target_month FROM monthly_closings WHERE group_id = ?1 AND target_month IN (?2, ?3)')
      .bind(groupId, month, previous),
    db.prepare('SELECT max(target_month) AS month FROM monthly_closings WHERE group_id = ?').bind(groupId),
    db
      .prepare(
        `SELECT from_member_id, to_member_id, amount_minor FROM settlement_transfers
          WHERE group_id = ?1 AND status = 'carried' AND closing_id = ${previousClosingId}`,
      )
      .bind(groupId, previous),
    db
      .prepare(
        `SELECT 1 AS found FROM settlement_transfers
          WHERE group_id = ?1 AND status = 'pending' AND closing_id = ${previousClosingId} LIMIT 1`,
      )
      .bind(groupId, previous),
    db.prepare('SELECT min(target_month) AS month FROM expenses WHERE group_id = ?').bind(groupId),
  ]);

  const memberMap = new Map<string, MemberInfo>();
  for (const row of members.results as {
    id: string;
    display_name: string;
    status: MemberInfo['status'];
    history_from_month: string;
    expense_end_month: string | null;
    leave_requested_month: string | null;
  }[]) {
    memberMap.set(row.id, {
      id: row.id,
      displayName: row.display_name,
      status: row.status,
      historyFromMonth: row.history_from_month,
      expenseEndMonth: row.expense_end_month,
      leaveRequestedMonth: row.leave_requested_month,
    });
  }

  const allocationMap = new Map<string, MemberAmount[]>();
  for (const row of allocations.results as { expense_id: string; member_id: string; burden_minor: number }[]) {
    const list = allocationMap.get(row.expense_id) ?? [];
    list.push({ memberId: row.member_id, amount: row.burden_minor });
    allocationMap.set(row.expense_id, list);
  }

  const shareMap = new Map<string, MemberShare[]>();
  for (const row of shares.results as { category_id: string; member_id: string; share_basis_points: number }[]) {
    const list = shareMap.get(row.category_id) ?? [];
    list.push({ memberId: row.member_id, basisPoints: row.share_basis_points });
    shareMap.set(row.category_id, list);
  }
  const rules = new Map<string, CategoryRuleSource>();
  for (const row of settings.results as {
    category_id: string;
    source_month: string;
    archived: number;
    cap_member_id: string | null;
    cap_minor: number | null;
    member_changed_at: number | null;
  }[]) {
    rules.set(row.category_id, {
      sourceMonth: row.source_month,
      archived: row.archived === 1,
      memberChangedAt: row.member_changed_at,
      rule: {
        categoryId: row.category_id,
        shares: shareMap.get(row.category_id) ?? [],
        cap: row.cap_member_id === null ? null : { memberId: row.cap_member_id, capMinor: row.cap_minor! },
      },
    });
  }

  return {
    members: memberMap,
    expenses: expenses.results as unknown as ExpenseSummaryRow[],
    allocations: allocationMap,
    rules,
    carriedIn: (carried.results as { from_member_id: string; to_member_id: string; amount_minor: number }[]).map(
      (row) => ({ fromMemberId: row.from_member_id, toMemberId: row.to_member_id, amountMinor: row.amount_minor }),
    ),
    closings: (closings.results as { id: string; target_month: string }[]).map((row) => ({
      id: row.id,
      month: row.target_month,
    })),
    latestClosedMonth: (latest.results[0] as { month: string | null } | undefined)?.month ?? null,
    previousHasPending: pending.results.length > 0,
    firstExpenseMonth: (firstExpense.results[0] as { month: string | null } | undefined)?.month ?? null,
  };
}

export interface ComputedMonth {
  result: MonthResult;
  /** その月の支出の総額（繰越を含めない）。 */
  totalMinor: number;
}

/**
 * 読み込んだものから、月の集計と送金を計算する（締める前の見込みも、締めるときも、この関数）。
 * 集計に出すメンバーは、その月に参加している全員と、支出・費目の割合・繰越に出てくる全員。
 * 費目の設定が無い費目の `category` の支出があれば、投げる（費目を作るときに必ず設定を書くので、実装の誤り）。
 */
export function computeMonthFromState(state: MonthState, month: string): ComputedMonth {
  const memberIds = new Set<string>();
  for (const member of state.members.values()) {
    if (participatesInMonth(member, month)) memberIds.add(member.id);
  }

  const monthExpenses: MonthExpense[] = [];
  const usedCategories = new Set<string>();
  let totalMinor = 0;
  for (const row of state.expenses) {
    memberIds.add(row.payer_member_id);
    totalMinor += row.amount_minor;
    const base = { amountMinor: row.amount_minor, categoryId: row.category_id, payerMemberId: row.payer_member_id };
    if (row.split_method === 'category') {
      usedCategories.add(row.category_id);
      monthExpenses.push({ ...base, splitMethod: 'category' });
      continue;
    }
    const allocations = state.allocations.get(row.id) ?? [];
    for (const allocation of allocations) memberIds.add(allocation.memberId);
    monthExpenses.push({ ...base, splitMethod: row.split_method, allocations });
  }

  const categories: CategoryRule[] = [];
  for (const categoryId of usedCategories) {
    const source = state.rules.get(categoryId);
    if (source === undefined) throw new SettlementInputError(`費目の設定が無い: ${categoryId}`);
    categories.push(source.rule);
    for (const share of source.rule.shares) memberIds.add(share.memberId);
  }
  for (const transfer of state.carriedIn) {
    memberIds.add(transfer.fromMemberId);
    memberIds.add(transfer.toMemberId);
  }

  const result = computeMonth({
    memberIds: [...memberIds],
    categories,
    expenses: monthExpenses,
    carriedIn: state.carriedIn,
  });
  return { result, totalMinor };
}

/** 月を締められない理由。`forbidden` は403、それ以外は409のエラー名（9章）。 */
export type CloseBlock =
  | { reason: 'forbidden' }
  | { reason: 'month_closed' }
  /** 締めていないが、最後に締めた月より前（飛ばした月）。締め済みではないので、`month_closed` と区別する。 */
  | { reason: 'month_skipped' }
  | { reason: 'month_not_started' }
  | { reason: 'previous_month_not_closed' | 'previous_month_unsettled'; month: string };

/**
 * 月を締められるか（4章「月締めの条件」）。締められれば null。
 *
 * - 操作者が、その月のメンバーであること（参加前の月、脱退月が終わった月は、締められない）。
 * - すでに締めた月は `month_closed`。最後に締めた月より前で、締めていない月（飛ばした月）は `month_skipped`
 *   （月は古い順にしか締めないので、締められない）。
 * - 前の月が締め済みなら、その送金がすべて処理済み（settled / carried）であること。
 * - 前の月が未締めなら、締められない。例外は、グループで最初の月（締めがまだ1つも無く、最初の支出がある月以前。
 *   支出が無ければ作成月以前）。作成月に支出が無く、翌月に最初の支出を登録したグループは、作成月を締めずに、
 *   翌月を最初に締められる。
 */
export function evaluateClose(state: MonthState, access: GroupAccess, month: string, now: number): CloseBlock | null {
  if (!participatesInMonth(access.member, month)) return { reason: 'forbidden' };
  if (state.closings.some((closing) => closing.month === month)) return { reason: 'month_closed' };
  // 最後に締めた月自身は上で `month_closed` になっているので、ここに来るのは、それより前の月だけ。
  if (state.latestClosedMonth !== null && month < state.latestClosedMonth) return { reason: 'month_skipped' };
  if (month > monthIn(access.group.timezone, now)) return { reason: 'month_not_started' };

  const previous = previousMonth(month);
  if (state.closings.some((closing) => closing.month === previous)) {
    return state.previousHasPending ? { reason: 'previous_month_unsettled', month: previous } : null;
  }
  const firstMonth = state.firstExpenseMonth ?? monthIn(access.group.timezone, access.group.createdAt);
  if (state.latestClosedMonth === null && month <= firstMonth) return null;
  return { reason: 'previous_month_not_closed', month: previous };
}
