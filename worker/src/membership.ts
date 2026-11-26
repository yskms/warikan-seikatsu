// メンバーの増減にともなう書き込みの共通部分（参加・脱退の確定・グループの削除）。規則は
// docs/backend-design.md 5章。月締め（closings.ts）・脱退を選ぶ操作（leave.ts）・月初のCron（cron.ts）・
// 参加（invites.ts）が同じ関数を使う（脱退の確定を、経路ごとに別々に書くと、確定の中身がずれるため）。
//
// ここの `...Statements` は、どれも GROUP_WRITE_GUARD の条件つき（8章）。`writeToGroup` の build の中で呼ぶ。
// 読み込み（`loadMembers`・`loadCategoryIds`）は、バージョンを読んだあとに呼ぶ（groupWrite.ts 冒頭の注意1）。
import { isLeaveEffectiveFor, latestClosedMonth, participatesInMonth } from './access.ts';
import { markLeftStatement } from './closedMonth.ts';
import { GROUP_WRITE_GUARD, insertRowsGuarded, readDataVersion, writeToGroup } from './groupWrite.ts';
import { MAX_MEMBERS_PER_GROUP } from './limits.ts';
import type { MemberInfo, ShareChangeKind } from './monthState.ts';
import { monthIn, nextMonth } from './months.ts';
import { allocateEqually, BASIS_POINTS_TOTAL } from './settlement.ts';

/** アカウントを削除したメンバーの表示名（5章「アカウント削除」）。 */
export const DELETED_USER_NAME = '削除されたユーザー';

/**
 * メンバーのアイコンの色のキー（`group_members.color`）。アプリの色の一覧と、このキーで揃える
 * （docs/backend-design.md 9章。アプリとはコードを共有しない）。画面設計メモの「10色ほど」の、仮の一覧。
 */
export const MEMBER_COLORS = ['pink', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'brown', 'gray'] as const;

/**
 * 参加したメンバーの色を、他のメンバーと重ならないように選ぶ（画面設計メモ「グループの設定」）。`preferred`（復帰する
 * 人の元の色）が使われていなければ、それを使う。全色が使われていれば、使われている数で一巡させる。
 */
export function pickMemberColor(usedColors: readonly string[], preferred: string | null = null): string {
  if (preferred !== null && !usedColors.includes(preferred)) return preferred;
  return MEMBER_COLORS.find((color) => !usedColors.includes(color)) ?? MEMBER_COLORS[usedColors.length % MEMBER_COLORS.length]!;
}

/** `group_members` の行のうち、`MemberInfo` に使う列（`MEMBER_INFO_COLUMNS` で引く）。 */
export interface MemberInfoRow {
  id: string;
  display_name: string;
  status: MemberInfo['status'];
  history_from_month: string;
  expense_end_month: string | null;
  leave_requested_month: string | null;
}

/** `MemberInfoRow` の列。 */
export const MEMBER_INFO_COLUMNS = 'id, display_name, status, history_from_month, expense_end_month, leave_requested_month';

/**
 * 行から `MemberInfo` への変換。**`MemberInfo` を作る道は、これだけ**にする（`loadMembers` と、グループ情報の
 * `leaveDeletesGroup` の計算〔groups.ts〕が使う）。`MemberInfo` に項目が増えたとき、片方だけ古いまま `isLastMember` に渡らない。
 */
export function toMemberInfo(row: MemberInfoRow): MemberInfo {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    historyFromMonth: row.history_from_month,
    expenseEndMonth: row.expense_end_month,
    leaveRequestedMonth: row.leave_requested_month,
  };
}

/** グループの全メンバー（脱退済み・削除済みを含む）。 */
export async function loadMembers(db: D1Database, groupId: string): Promise<MemberInfo[]> {
  const { results } = await db
    .prepare(`SELECT ${MEMBER_INFO_COLUMNS} FROM group_members WHERE group_id = ?`)
    .bind(groupId)
    .all<MemberInfoRow>();
  return results.map(toMemberInfo);
}

/**
 * 人数の上限（`MAX_MEMBERS_PER_GROUP`）で数える、今月以降もグループにいるメンバーの数。脱退が確定した（`leaving`
 * 以降）・脱退月が終わった（Cronの確定の前でも）人は数えない（入れ替わりの参加をふさがない）。脱退を選んだだけで、
 * 脱退月がまだ終わっていない人は、今月はいるので数える。判定は access.ts の `isLeaveEffectiveFor` と同じ。
 */
export function countSeatedMembers(
  members: readonly { status: string; leaveRequestedMonth: string | null }[],
  timezone: string,
  now: number,
): number {
  return members.filter((member) => !isLeaveEffectiveFor(member, timezone, now)).length;
}

/**
 * グループの人数が上限（`MAX_MEMBERS_PER_GROUP`）か。招待の発行・参加・招待内容の確認・グループ情報の `canInvite` が
 * 同じ判定を使う（数え方や上限の条件を変えるときに、表示と実際の判定が食い違わない）。
 */
export function isGroupFull(
  members: readonly { status: string; leaveRequestedMonth: string | null }[],
  timezone: string,
  now: number,
): boolean {
  return countSeatedMembers(members, timezone, now) >= MAX_MEMBERS_PER_GROUP;
}

/** グループの全費目のID（アーカイブ済みも含む）。 */
export async function loadCategoryIds(db: D1Database, groupId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT id FROM categories WHERE group_id = ? ORDER BY id')
    .bind(groupId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/** その月の集計に入るメンバーのID（参加（復帰）した月から、脱退月まで。`status` は見ない）。 */
export function participantIds(members: readonly MemberInfo[], month: string): string[] {
  return members.filter((member) => participatesInMonth(member, month)).map((member) => member.id);
}

/**
 * 見直しのお知らせの印（`category_month_settings.member_changed_at`・`member_changed_kind`）。まだ誰も見直していない割合に付ける
 * （マイグレーション0007・0008）。手で保存した行・費目を作ったときに書く行には付けない（`null`）。
 */
export interface ShareChangeMark {
  /** 割合を書き換えた時刻（Unixエポックのミリ秒）。 */
  at: number;
  kind: ShareChangeKind;
}

/** 1つの費目の、1か月分の割合と上限額（`category_month_settings`・`category_month_shares` の行）。 */
export interface RuleRows {
  categoryId: string;
  shares: readonly { memberId: string; basisPoints: number }[];
  cap: { memberId: string; capMinor: number } | null;
  /** この行に付ける印。無ければ（手で書いた行と同じ扱い）null。 */
  mark: ShareChangeMark | null;
}

/**
 * 月の割合の行を、`rules` で消して書き直す。その月の既存の行は、全費目分を消す（`rules` に無い費目の行も）。
 * `rules` が空なら何もしない。**締めた月には使わない**（締めた月の割合は確定している）。呼び出し側が、未締めの月を渡す。
 */
function rewriteSharesStatements(
  db: D1Database,
  token: string,
  groupId: string,
  month: string,
  rules: readonly RuleRows[],
): D1PreparedStatement[] {
  if (rules.length === 0) return [];
  const remove = (table: string) =>
    db
      .prepare(`DELETE FROM ${table} WHERE group_id = ? AND target_month = ? AND EXISTS (${GROUP_WRITE_GUARD})`)
      .bind(groupId, month, groupId, token);
  return [
    remove('category_month_shares'),
    remove('category_month_settings'),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_settings',
      ['group_id', 'category_id', 'target_month', 'cap_member_id', 'cap_minor', 'member_changed_at', 'member_changed_kind'],
      rules.map((rule) => [
        groupId,
        rule.categoryId,
        month,
        rule.cap?.memberId ?? null,
        rule.cap?.capMinor ?? null,
        rule.mark?.at ?? null,
        rule.mark?.kind ?? null,
      ]),
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_shares',
      ['group_id', 'category_id', 'target_month', 'member_id', 'share_basis_points'],
      rules.flatMap((rule) => rule.shares.map((share) => [groupId, rule.categoryId, month, share.memberId, share.basisPoints])),
    ),
  ];
}

/**
 * 月の全費目の負担割合を、`memberIds` での均等にリセットし、上限額の設定も外す（5章。メンバーが増減したとき）。
 * その月の既存の行は消して書き直す。端数は、IDの昇順の先頭から1ずつ（2章）。
 *
 * **締めた月には使わない**（締めた月の割合は確定している）。呼び出し側が、未締めの月を渡す。
 * 費目はアーカイブ済みも含めて全部書く（あとで戻された費目が、古い割合に戻らないように）。
 * メンバーが0人なら何もしない（その月を使う人がいない）。
 *
 * 書いた行には、`mark` を入れる（見直しのお知らせの印。まだ見直されていない）。**システムが、メンバーの増減で戻すときは、
 * 必ず印を付ける**（参加・脱退の確定・アカウント削除の3つが通る。付けないと、戻したことがお知らせに出ない）。`mark` が
 * `null` なのは、利用者が「全費目を均等にする」を押して、自分で戻したとき（`handleResetSharesToEqual`）だけ。
 */
export function resetSharesStatements(
  db: D1Database,
  token: string,
  groupId: string,
  month: string,
  categoryIds: readonly string[],
  memberIds: readonly string[],
  mark: ShareChangeMark | null,
): D1PreparedStatement[] {
  if (memberIds.length === 0 || categoryIds.length === 0) return [];
  const shares = allocateEqually(BASIS_POINTS_TOTAL, memberIds).map((share) => ({
    memberId: share.memberId,
    basisPoints: share.amount,
  }));
  return rewriteSharesStatements(
    db,
    token,
    groupId,
    month,
    categoryIds.map((categoryId) => ({ categoryId, shares, cap: null, mark })),
  );
}

/**
 * 割合をリセットする最初の月。メンバーの増減が効く月（`month`）と、最初の未締めの月（`closedThrough` の翌月）の、
 * 遅いほう。締めた月の割合は確定しているので、触れない。締めた月がリセットの月より後なら、その次の月から直す
 * （締めた月の割合を引き継ぐ、最初の未締めの月に、増減したメンバーを反映するため）。
 */
export function firstResettableMonth(month: string, closedThrough: string | null): string {
  if (closedThrough === null) return month;
  const firstOpen = nextMonth(closedThrough);
  return month >= firstOpen ? month : firstOpen;
}

/**
 * 割合の行がある月のうち、`afterMonth` より後のもの（昇順・重複なし）。まだ締めていなければ（null）、すべて。
 * `resetMonthsStatements` に渡す。
 */
export async function loadRuleMonthsAfter(db: D1Database, groupId: string, afterMonth: string | null): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT target_month FROM category_month_settings
        WHERE group_id = ?1 AND target_month > ?2 ORDER BY target_month`,
    )
    .bind(groupId, afterMonth ?? '')
    .all<{ target_month: string }>();
  return results.map((row) => row.target_month);
}

/**
 * リセットする月の一覧。`baseMonths`（メンバーの増減で割合を戻す月）と、そのどれかより後で、割合の行がある月
 * （`ruleMonths`）。昇順・重複なし。
 *
 * 後の月の行は、その月以前で最も新しい行を引き継ぐ割合（3章）を、上書きしている。そこを直さないと、増えたメンバーが
 * その月の割合に入らず（負担が0のまま続く）、減ったメンバーが残る。たとえば、アカウント削除は未締めの今月の
 * うちに、翌月の行を書く。そのあと同じ月に参加した人は、翌月の行に入れない。
 */
export function monthsToReset(baseMonths: readonly string[], ruleMonths: readonly string[]): string[] {
  const months = new Set(baseMonths);
  for (const month of ruleMonths) {
    if (baseMonths.some((base) => month > base)) months.add(month);
  }
  return [...months].sort();
}

/**
 * `baseMonths` と、それより後に行がある月（`ruleMonths`）の全費目の割合を、それぞれの月に参加しているメンバーでの
 * 均等にリセットする（`members` は、メンバーの増減を反映した状態）。後の月の行は、手で直された割合も上書きする。
 * 締めた月には使わない（`baseMonths` と `ruleMonths` は、締めた月より後の月だけ）。
 */
export function resetMonthsStatements(
  db: D1Database,
  token: string,
  groupId: string,
  input: {
    members: readonly MemberInfo[];
    categoryIds: readonly string[];
    baseMonths: readonly string[];
    ruleMonths: readonly string[];
    /**
     * 戻した時刻（見直しのお知らせの印。`resetSharesStatements`。種類は `reset`）。利用者が自分で戻すとき
     * （`handleResetSharesToEqual`）だけ、印を付けない `null`。
     */
    now: number | null;
  },
): D1PreparedStatement[] {
  const mark: ShareChangeMark | null = input.now === null ? null : { at: input.now, kind: 'reset' };
  return monthsToReset(input.baseMonths, input.ruleMonths).flatMap((month) =>
    resetSharesStatements(db, token, groupId, month, input.categoryIds, participantIds(input.members, month), mark),
  );
}

// ---------------------------------------------------------------------------
// 参加の割合（5章「参加」）

/** 参加のときに、月ごとにどう書くか。 */
export interface JoinMonthPlan {
  month: string;
  /**
   * true: 今の割合を残し、新しいメンバーを0%で足す（`joined` の印）。参加前にその月の集計に入っているメンバーが2人以上いる。
   * false: 均等にリセットする（`reset` の印）。参加前に入っているメンバーが1人以下（グループを作った人だけ、など）。
   * 1人から2人になるときは、手で直した割合がまだ無いので、均等に戻す。
   */
  keepShares: boolean;
}

/**
 * 参加のときの、月ごとの書き方。月は `monthsToReset` と同じ（参加の効く最初の月と、それより後で割合の行がある月）。
 * `membersBefore` は参加前のメンバー（参加する本人を含まない）。人数だけで決める（割合が均等かどうかは見ない）。
 */
export function planJoinMonths(
  membersBefore: readonly MemberInfo[],
  baseMonth: string,
  ruleMonths: readonly string[],
): JoinMonthPlan[] {
  return monthsToReset([baseMonth], ruleMonths).map((month) => ({
    month,
    keepShares: participantIds(membersBefore, month).length >= 2,
  }));
}

/** 費目の、その月に使う割合と上限額（その月以前で最も新しい月の行）。 */
export interface SourceRule {
  shares: readonly { memberId: string; basisPoints: number }[];
  cap: { memberId: string; capMinor: number } | null;
}

/**
 * `months` それぞれで使われている、費目ごとの割合（その月以前で最も新しい月の行。3章）。割合の行が1つも無い費目（作る前の月）
 * は含まない。月ごとに、設定と割合を1回ずつ読む（月の数は、参加の効く月と、行がある後の月だけ）。
 * バージョンを読んだあとに呼ぶ（groupWrite.ts 冒頭の注意1）。
 */
export async function loadSourceRules(
  db: D1Database,
  groupId: string,
  months: readonly string[],
): Promise<Map<string, Map<string, SourceRule>>> {
  const result = new Map<string, Map<string, SourceRule>>();
  if (months.length === 0) return result;
  const currentRule = `(SELECT max(target_month) FROM category_month_settings WHERE category_id = c.id AND target_month <= ?2)`;
  const rows = await db.batch(
    months.flatMap((month) => [
      db
        .prepare(
          `SELECT s.category_id AS category_id, s.cap_member_id AS cap_member_id, s.cap_minor AS cap_minor
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
            WHERE c.group_id = ?1 ORDER BY sh.member_id`,
        )
        .bind(groupId, month),
    ]),
  );
  months.forEach((month, index) => {
    const settings = rows[index * 2]!.results as {
      category_id: string;
      cap_member_id: string | null;
      cap_minor: number | null;
    }[];
    const shares = rows[index * 2 + 1]!.results as { category_id: string; member_id: string; share_basis_points: number }[];
    const rules = new Map<string, SourceRule>();
    for (const row of settings) {
      rules.set(row.category_id, {
        shares: [],
        cap: row.cap_member_id === null ? null : { memberId: row.cap_member_id, capMinor: row.cap_minor! },
      });
    }
    for (const row of shares) {
      (rules.get(row.category_id)!.shares as { memberId: string; basisPoints: number }[]).push({
        memberId: row.member_id,
        basisPoints: row.share_basis_points,
      });
    }
    result.set(month, rules);
  });
  return result;
}

/**
 * 今の割合を残して、新しいメンバーを0%で足した行。合計が10000にならない（新しいメンバーの古い行が残っている、など。
 * 起こらない想定）ときや、上限を負担する人が新しいメンバーのときは null（呼び出し側が、均等に戻す）。
 */
function withNewMemberAtZero(source: SourceRule, newMemberId: string): Pick<RuleRows, 'shares' | 'cap'> | null {
  const kept = source.shares.filter((share) => share.memberId !== newMemberId);
  if (kept.reduce((sum, share) => sum + share.basisPoints, 0) !== BASIS_POINTS_TOTAL) return null;
  if (source.cap?.memberId === newMemberId) return null;
  return { shares: [...kept, { memberId: newMemberId, basisPoints: 0 }], cap: source.cap };
}

/**
 * 参加の割合の書き込み（5章「参加」）。`plan` は `planJoinMonths`。
 * - `keepShares` の月: 全費目の今の割合と上限額を残し、新しいメンバーを0%で足す（`sources` は、その月の `loadSourceRules`）。
 *   その月の行は、消して書き直す（その月の行が無かったときも、引き継いでいた行を、その月の行として書く）。印は `joined`。
 * - それ以外の月: `resetSharesStatements` と同じ、参加後のメンバーでの均等（上限額は外す）。印は `reset`。
 * 費目はアーカイブ済みも含めて全部書く。今の割合が見つからない費目（作る前の月）は、均等に戻す。
 * **締めた月には使わない**（呼び出し側が、`firstResettableMonth` 以降の月を渡す）。
 */
export function joinSharesStatements(
  db: D1Database,
  token: string,
  groupId: string,
  input: {
    plan: readonly JoinMonthPlan[];
    membersAfter: readonly MemberInfo[];
    newMemberId: string;
    categoryIds: readonly string[];
    sources: ReadonlyMap<string, ReadonlyMap<string, SourceRule>>;
    now: number;
  },
): D1PreparedStatement[] {
  const { plan, membersAfter, newMemberId, categoryIds, sources, now } = input;
  return plan.flatMap(({ month, keepShares }) => {
    const participants = participantIds(membersAfter, month);
    if (participants.length === 0 || categoryIds.length === 0) return [];
    const equal = allocateEqually(BASIS_POINTS_TOTAL, participants).map((share) => ({
      memberId: share.memberId,
      basisPoints: share.amount,
    }));
    const reset: Pick<RuleRows, 'shares' | 'cap' | 'mark'> = { shares: equal, cap: null, mark: { at: now, kind: 'reset' } };
    const rules: RuleRows[] = categoryIds.map((categoryId) => {
      const source = keepShares ? sources.get(month)?.get(categoryId) : undefined;
      const kept = source === undefined ? null : withNewMemberAtZero(source, newMemberId);
      if (kept === null) return { categoryId, ...reset };
      return { categoryId, ...kept, mark: { at: now, kind: 'joined' } };
    });
    return rewriteSharesStatements(db, token, groupId, month, rules);
  });
}

/**
 * 固定費の自動登録を止める（5章）。すでに止まっているもの（手動の停止など）は、理由を上書きしない。
 * - `payerMemberIds` が支払者の固定費: `payer_left`（付け替えられていないもの）。
 * - `memberChanged`: `category` 以外の負担方法の固定費は `member_changed`（個別の負担が、メンバーの増減で
 *   合わなくなる）。支払者が対象のものは、先に `payer_left` で止まっている。
 * 止めた固定費を再開するときは、そのAPIが、支払者・負担の対象が今のメンバーで有効かを確かめる。
 */
export function pauseRecurringStatements(
  db: D1Database,
  token: string,
  groupId: string,
  now: number,
  options: { payerMemberIds: readonly string[]; memberChanged: boolean },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (options.payerMemberIds.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE recurring_expenses SET paused_at = ?, paused_reason = 'payer_left', updated_at = ?
            WHERE group_id = ? AND paused_at IS NULL AND payer_member_id IN (${options.payerMemberIds.map(() => '?').join(', ')})
              AND EXISTS (${GROUP_WRITE_GUARD})`,
        )
        .bind(now, now, groupId, ...options.payerMemberIds, groupId, token),
    );
  }
  if (options.memberChanged) {
    statements.push(
      db
        .prepare(
          `UPDATE recurring_expenses SET paused_at = ?, paused_reason = 'member_changed', updated_at = ?
            WHERE group_id = ? AND paused_at IS NULL AND split_method <> 'category' AND EXISTS (${GROUP_WRITE_GUARD})`,
        )
        .bind(now, now, groupId, groupId, token),
    );
  }
  return statements;
}

/** `memberIds` が発行した、未使用（使われていない・取り消されていない）の招待をすべて取り消す。期限切れも取り消す。 */
export function revokeInvitesStatement(
  db: D1Database,
  token: string,
  groupId: string,
  now: number,
  memberIds: readonly string[],
): D1PreparedStatement[] {
  if (memberIds.length === 0) return [];
  return [
    db
      .prepare(
        `UPDATE invites SET revoked_at = ?
          WHERE group_id = ? AND consumed_at IS NULL AND revoked_at IS NULL
            AND invited_by_member_id IN (${memberIds.map(() => '?').join(', ')}) AND EXISTS (${GROUP_WRITE_GUARD})`,
      )
      .bind(now, groupId, ...memberIds, groupId, token),
  ];
}

/**
 * 脱退を確定させる対象（5章「脱退」の2）。`throughMonth` 以前を脱退月に選んだままの、参加中（`active`）のメンバー。
 * 月締めは、締める月を渡す。Cronは、グループの今月より前の月を渡す（月が終わったもの）。
 */
export function dueLeaves(members: readonly MemberInfo[], throughMonth: string): MemberInfo[] {
  return members.filter(
    (member) =>
      member.status === 'active' && member.leaveRequestedMonth !== null && member.leaveRequestedMonth <= throughMonth,
  );
}

/**
 * 確定する脱退者が、グループの最後の1人か。参加中・脱退が確定した（`leaving`）メンバーが、その1人だけのとき。
 * 2人以上が同時に抜けるときは、お互いの精算が残るので、グループは消さない（全員が脱退済みになったグループの
 * 後片付けは、docs/backend-design.md 12章）。
 */
export function isLastMember(members: readonly MemberInfo[], due: readonly MemberInfo[]): boolean {
  const remaining = members.filter((member) => member.status === 'active' || member.status === 'leaving');
  return due.length === 1 && remaining.length === 1 && remaining[0]!.id === due[0]!.id;
}

/**
 * `month` を締めると、グループのデータがすべて消えるか。この月を脱退月に選んでいるメンバーが、最後の1人のとき、
 * 月を締めずに、グループを消す（`handleCloseMonth`。closings.ts）。アプリが、締める前の確認で警告を出せるように、
 * `summary` の `close.deletesGroup` で返す（最後の1人かの規則を、アプリに書き写さない）。
 *
 * 脱退月が、この月より前の脱退者（最初の締めで飛ばされた月。`handleCloseMonth` は、先に確定させて409を返す）は、
 * 最後の1人にならない。脱退月が終わった本人は、その月の集計に入らず、締められない（access.ts の `participatesInMonth`）。
 * 締められるのは、ほかの参加中・脱退が確定した（`leaving`）メンバーで、その人も「残る人」に数えるため。
 */
export function closeDeletesGroup(members: readonly MemberInfo[], month: string): boolean {
  return isLastMember(members, dueLeaves(members, month));
}

/**
 * 脱退の確定の書き込み（5章「脱退」の2）。`due` は、`dueLeaves` で選んだメンバー。最後の1人のときは使わず、
 * `deleteGroupStatements` で、グループごと消す。
 * - `expense_end_month` に脱退月を入れ、`status` を `leaving` にする。
 * - 脱退月の翌月の全費目の割合を、残るメンバーでの均等にリセットする（`members` は、確定前の状態）。
 * - 発行した未使用の招待を取り消す。
 * - 脱退者が支払者の固定費と、`category` 以外の固定費の自動登録を止める。
 * 脱退済み（`left`）への遷移は含まない。呼び出し側が、`markLeftStatement`（closedMonth.ts）を、これの後ろに足す。
 *
 * `closedThrough`: この書き込みのあとで、締め済みになっている最後の月（まだ締めていなければ null）。割合のリセットは、
 * それより後の月だけ行う（締めた月の割合は確定している。月締めの中で呼ぶときは、いま締める月。`firstResettableMonth`）。
 * 脱退月の翌月が、すでに締め済みのときは、最初の未締めの月から直す。
 */
export function confirmLeaveStatements(
  db: D1Database,
  token: string,
  groupId: string,
  now: number,
  context: {
    members: readonly MemberInfo[];
    due: readonly MemberInfo[];
    categoryIds: readonly string[];
    closedThrough: string | null;
    /** `closedThrough` より後で、割合の行がある月（`loadRuleMonthsAfter`）。 */
    ruleMonths: readonly string[];
  },
): D1PreparedStatement[] {
  const { members, due, categoryIds, closedThrough, ruleMonths } = context;
  if (due.length === 0) return [];
  const dueIds = due.map((member) => member.id);
  const baseMonths = due.map((member) => firstResettableMonth(nextMonth(member.leaveRequestedMonth!), closedThrough));
  return [
    db
      .prepare(
        `UPDATE group_members SET status = 'leaving', expense_end_month = leave_requested_month
          WHERE group_id = ? AND status = 'active' AND leave_requested_month IS NOT NULL
            AND id IN (${dueIds.map(() => '?').join(', ')}) AND EXISTS (${GROUP_WRITE_GUARD})`,
      )
      .bind(groupId, ...dueIds, groupId, token),
    // 脱退月の翌月に参加しているのは、脱退を選んだメンバーを除く、そのとき参加している全員。それより後の月の行も直す。
    ...resetMonthsStatements(db, token, groupId, { members, categoryIds, baseMonths, ruleMonths, now }),
    ...revokeInvitesStatement(db, token, groupId, now, dueIds),
    ...pauseRecurringStatements(db, token, groupId, now, { payerMemberIds: dueIds, memberChanged: true }),
  ];
}

/**
 * グループの配下のデータをすべて物理削除する文（5章「グループの削除」）。外部キーに `ON DELETE CASCADE` を付けていない
 * ので、子から順に消す。`expense_groups` の行は消さない（`deleteGroupRowStatement`）。複数のグループにまたがる
 * 書き込み（アカウント削除）では、グループの行の削除を、ほかの文の最後にまとめるため、分けてある。
 */
export function deleteGroupChildrenStatements(db: D1Database, token: string, groupId: string): D1PreparedStatement[] {
  const children = [
    'settlement_transfers',
    'closing_category_burdens',
    'closing_member_summaries',
    'monthly_closings',
    'expense_allocations',
    'expenses',
    'recurring_expense_runs',
    'recurring_expense_allocations',
    'recurring_expenses',
    'category_month_shares',
    'category_month_settings',
    'categories',
    'invites',
    'group_members',
  ];
  return children.map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE group_id = ? AND EXISTS (${GROUP_WRITE_GUARD})`).bind(groupId, groupId, token),
  );
}

/** `expense_groups` の行を消す文。token の一致を条件にする。配下のデータを消したあとで使う。 */
export function deleteGroupRowStatement(db: D1Database, token: string, groupId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM expense_groups WHERE id = ? AND write_token = ?').bind(groupId, token);
}

/** グループのデータをすべて物理削除する文（5章「グループの削除」）。 */
export function deleteGroupStatements(db: D1Database, token: string, groupId: string): D1PreparedStatement[] {
  return [...deleteGroupChildrenStatements(db, token, groupId), deleteGroupRowStatement(db, token, groupId)];
}

export interface EndedLeavesResult {
  /**
   * - `confirmed`: 脱退を確定させた。
   * - `deleted`: 最後の1人の脱退を確定させて、グループを削除した。
   * - `deferred`: 他の書き込みと競合したので、何も変えなかった（やり直さない）。
   * - `nothing`: 確定させるものが無い（グループが無い場合も）。
   */
  result: 'confirmed' | 'deleted' | 'deferred' | 'nothing';
  /** この処理が使ったD1のクエリ数（読み込みと、書き込みの文の数）。Cronの、1回の実行の予算の計算に使う。 */
  queries: number;
}

/**
 * 1つのグループの、脱退月が終わった脱退（グループのタイムゾーンの今月より前の月を脱退月に選んだままの、参加中のメンバー）
 * を確定させる（5章）。月初のCron（cron.ts）と、月締め（脱退月が、最初の締めで飛ばされた月のとき。closings.ts）が使う。
 * バージョンを先に読み、そのあとでデータを読む（groupWrite.ts 冒頭の注意1）。やり直さない（競合したら `deferred`）。
 */
export async function confirmEndedLeaves(db: D1Database, groupId: string, now: number): Promise<EndedLeavesResult> {
  let queries = 0;
  const counted = <T>(promise: Promise<T>): Promise<T> => {
    queries += 1;
    return promise;
  };
  const nothing = (): EndedLeavesResult => ({ result: 'nothing', queries });

  const version = await counted(readDataVersion(db, groupId));
  if (version === null) return nothing();
  const group = await counted(
    db.prepare('SELECT timezone FROM expense_groups WHERE id = ?').bind(groupId).first<{ timezone: string }>(),
  );
  if (group === null) return nothing();
  const members = await counted(loadMembers(db, groupId));
  // グループの今月より前の月を脱退月に選んだメンバー（月が終わったもの）。
  const currentMonth = monthIn(group.timezone, now);
  const due = dueLeaves(members, currentMonth).filter((member) => member.leaveRequestedMonth! < currentMonth);
  if (due.length === 0) return nothing();

  // 最後の1人の脱退は、確定と同時に、グループのデータをすべて消す（5章「グループの削除」）。
  const lastMember = isLastMember(members, due);
  const categoryIds = lastMember ? [] : await counted(loadCategoryIds(db, groupId));
  const closedThrough = lastMember ? null : await counted(latestClosedMonth(db, groupId));
  const ruleMonths = lastMember ? [] : await counted(loadRuleMonthsAfter(db, groupId, closedThrough));

  let written = 0;
  const result = await writeToGroup(db, groupId, version, (token) => {
    const statements = lastMember
      ? deleteGroupStatements(db, token, groupId)
      : [
          ...confirmLeaveStatements(db, token, groupId, now, { members, due, categoryIds, closedThrough, ruleMonths }),
          // 脱退月がすでに締められていれば、送金が済んでいるメンバーは、そのまま脱退済みになる。
          markLeftStatement(
            db,
            token,
            groupId,
            now,
            due.map((member) => member.id),
          ),
        ];
    written = statements.length;
    return statements;
  });
  queries += 1 + written; // バージョンを上げる文と、書き込みの文
  if (result.ok) return { result: lastMember ? 'deleted' : 'confirmed', queries };
  // 'version': 利用者の操作と競合した。やり直さない（Cronは1時間ごとで冪等。月締めは409で読み直してもらう）。
  if (result.reason === 'version') return { result: 'deferred', queries };
  // 'unique': 確定の書き込みには、一意制約に触れる文が無い。出たら実装の誤りなので、握りつぶさない。
  throw new Error('脱退の確定で、想定外の一意制約違反');
}
