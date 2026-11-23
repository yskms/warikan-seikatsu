// 定期処理（Cron Triggers）。設計は docs/backend-design.md 7章。1時間ごとに動かし、グループのタイムゾーンで日付を
// 判定する。処理はすべて冪等（同じ時刻に2回動いても、結果が変わらない）。
//
// 入っている処理は2つ。順番に意味がある（1つ目の確定が済んでから、2つ目が固定費を読む）。
// 1. 月初の処理（脱退月が終わったのに締められていない脱退の確定。5章）。確定の中身は membership.ts の
//    `confirmEndedLeaves`（月締めも使う）。固定費の停止（`payer_left`・`member_changed`）もここで書く。
// 2. 固定費の自動登録（7章。src/recurringRun.ts）。1つ目で止まった固定費を、読み直して見送る。
import { confirmEndedLeaves } from './membership.ts';
import { monthIn } from './months.ts';
import { registerDueRecurring, type RecurringRunSummary } from './recurringRun.ts';

/**
 * 1回の実行で使うD1のクエリ数の予算。Freeは1回の呼び出しにつき50まで（Paidは1000）。公式（D1 Limits）は batch を1回と
 * 数えると書くが、本番のFreeで確かめるまでは、batch の1文も1クエリとして数える（安全側。実際の消費は、これより少ない。
 * docs/backend-design.md 8章の「D1のクエリ数の数え方」）。グループを1つ確定させるごとに、この数え方で約15クエリ使う
 * （読み込み5〜6、書き込み約10。`worker/test/cron.test.ts` で数えている）ので、Freeでは、1回に2グループほど。残りは次の回が引き受ける（APIは、脱退月が終わったメンバーを
 * 確定したものとして扱う。access.ts の `isLeaveEffective`）ので、遅れても、利用者の見える挙動は変わらない。
 * **Paidへ移すときは、1000に近い値へ上げる。確かめたあとに batch を1回と数える形へ直すときは、`queries`（読み込みと、書き込みの文の数）の数え方を直す。予算の仕組みは残す（batch の外の読み込みは、1回ずつ数える）。**
 */
export const QUERY_BUDGET_PER_RUN = 50;

/**
 * 次のグループに使うクエリ数の見積もり（予算に収まるかの判定に使う）。最も大きい場合（最後の1人の脱退でグループを削除する。
 * 読み込み3、書き込み16で、約19）に合わせる。割合の行がある先の月が多いと、これを超えることがある（超えたグループは、
 * 例外になって `failedGroups` に入り、次の回に回るだけ）ので、見積もりであって、上限の保証ではない。
 */
export const ESTIMATED_QUERIES_PER_GROUP = 20;

export interface CronSummary {
  /** 脱退を確定させたグループ（最後の1人の脱退で、削除したグループを含む）。 */
  confirmedGroups: string[];
  /** 他の書き込みと競合したので、次の回に回したグループ（何も変更していない）。 */
  deferredGroups: string[];
  /** 想定外のエラーで確定できなかったグループ。 */
  failedGroups: string[];
  /** 予算が尽きて、この回は手を付けなかったグループ。 */
  postponedGroups: string[];
  /** 固定費の自動登録（7章）。 */
  recurring: RecurringRunSummary;
  /** この回が使ったD1のクエリ数（脱退の確定と、固定費の自動登録の、探す1回と、グループごとの読み込み・書き込み）。 */
  queries: number;
}

/**
 * 脱退を選んだままのメンバーを引く検索。部分索引（idx_group_members_leave_requested）を使う。`GROUP BY` や
 * `ORDER BY group_id` を足すと、プランナーが、索引でなく全メンバーの走査を選ぶ（test/cron.test.ts で、索引を使うことを確かめている）。
 * グループごとのまとめと並べ替えは、JSで行う。
 */
export const DUE_LEAVES_SQL = `SELECT m.group_id AS group_id, g.timezone AS timezone, m.leave_requested_month AS month
     FROM group_members m JOIN expense_groups g ON g.id = m.group_id
    WHERE m.status = 'active' AND m.leave_requested_month IS NOT NULL`;

/** 脱退を選んだ月が終わっている（グループの今月より前の）メンバーがいるグループ。古い月のものから。 */
async function findGroupsWithDueLeaves(db: D1Database, now: number): Promise<string[]> {
  const { results } = await db.prepare(DUE_LEAVES_SQL).all<{ group_id: string; timezone: string; month: string }>();
  // 今月かどうかは、グループのタイムゾーンで決める。SQLでは決められないので、ここで絞る。
  const oldest = new Map<string, string>();
  for (const row of results) {
    if (row.month >= monthIn(row.timezone, now)) continue;
    const known = oldest.get(row.group_id);
    if (known === undefined || row.month < known) oldest.set(row.group_id, row.month);
  }
  return [...oldest.entries()]
    .sort(([idA, monthA], [idB, monthB]) => (monthA === monthB ? (idA < idB ? -1 : 1) : monthA < monthB ? -1 : 1))
    .map(([groupId]) => groupId);
}

/**
 * 1時間ごとの定期処理。`now` は予定の時刻（Unixエポックのミリ秒）。失敗したグループがあれば、最後に投げる。
 *
 * グループは、古い月のものから。1つ目は、予算を超えても必ず処理する（そうしないと、1つのグループの費用が予算より大きいとき、
 * 永久に進まない）。2つ目からは、いままでに使った数と、次の1グループの見積もり（`ESTIMATED_QUERIES_PER_GROUP` と、
 * これまでで最も大きかった1グループの費用の、大きいほう）の合計が、予算に収まるときだけ。
 * 予算に収まらないグループは、`postponedGroups` として、次の回に回す。
 */
export async function runScheduled(env: Env, now: number, queryBudget = QUERY_BUDGET_PER_RUN): Promise<CronSummary> {
  const groupIds = await findGroupsWithDueLeaves(env.DB, now);
  const summary: CronSummary = {
    confirmedGroups: [],
    deferredGroups: [],
    failedGroups: [],
    postponedGroups: [],
    recurring: {
      createdGroups: [],
      createdExpenses: 0,
      deferredGroups: [],
      failedGroups: [],
      postponedGroups: [],
      invalidTemplates: [],
      skipped: false,
      queries: 0,
    },
    queries: 1, // 探す1回
  };
  let largest = 0;
  for (const [index, groupId] of groupIds.entries()) {
    if (index > 0 && summary.queries + Math.max(largest, ESTIMATED_QUERIES_PER_GROUP) > queryBudget) {
      summary.postponedGroups.push(groupId);
      continue;
    }
    try {
      const { result, queries } = await confirmEndedLeaves(env.DB, groupId, now);
      summary.queries += queries;
      largest = Math.max(largest, queries);
      if (result === 'confirmed' || result === 'deleted') summary.confirmedGroups.push(groupId);
      if (result === 'deferred') summary.deferredGroups.push(groupId);
    } catch (error) {
      // 1つのグループの失敗で、ほかのグループを止めない。値（名前・金額など）はログに出さない。
      console.error('脱退の確定に失敗', groupId, error instanceof Error ? error.name : 'unknown');
      summary.failedGroups.push(groupId);
      // 失敗した分のクエリ数は分からないので、最も大きい1グループと同じだけ使ったものとして、予算を減らす。
      summary.queries += Math.max(largest, 1);
    }
  }

  // 固定費の自動登録は、脱退の確定（固定費の停止を含む）のあとに行う。予算が余っていなければ、この回は見送る。
  summary.recurring = await registerDueRecurring(env.DB, now, summary.queries, queryBudget);
  summary.queries += summary.recurring.queries;

  // 作れなかった固定費（不整合）も、気づけるように失敗として投げる。ほかのグループ・固定費は、もう作っている。
  const failed = summary.failedGroups.length + summary.recurring.failedGroups.length;
  if (failed > 0) throw new Error(`定期処理で失敗したグループがある: ${failed}件`);
  if (summary.recurring.invalidTemplates.length > 0) {
    throw new Error(`定期処理で作れなかった固定費がある: ${summary.recurring.invalidTemplates.length}件`);
  }
  return summary;
}
