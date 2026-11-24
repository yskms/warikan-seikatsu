// 脱退を選ぶ・取り消す。規則は docs/backend-design.md 5章「脱退」、形は9章「招待・参加・脱退」。
//
// - 「今月で脱退する」: `leave_requested_month` に、グループのタイムゾーンの今月（脱退月）を入れる。脱退を選んだ時点で
//   脱退月がすでに締められていれば（早めに締めた後）、その場で確定する（確定の中身は membership.ts。月締め・Cronと同じ）。
//   確定するまでは、`status` は `active` のまま。その確定が、グループを消す（最後の1人）ときは、利用者の申告
//   （`acknowledgeDelete=true`。`deleteAck.ts`）が無ければ、何も書かずに409 `delete_not_acknowledged` を返す。
// - 取り消し: 確定するまでの、脱退月の間だけ。脱退月が終わったら、Cronの確定を待たずに、確定したものとして断る
//   （access.ts の `isLeaveEffective`）。
// - やり直さずに、競合したら409を返す（8章。確認ダイアログの内容が変わりうるため）。
//   バージョンを先に読み、そのあとでデータを読む（groupWrite.ts 冒頭の注意1）。
import { authenticateRequest, isLeaveEffective, isMonthClosed, latestClosedMonth, loadGroupAccess } from './access.ts';
import { markLeftStatement } from './closedMonth.ts';
import { acknowledgesDelete, deleteNotAcknowledged } from './deleteAck.ts';
import { GROUP_WRITE_GUARD, readDataVersion, writeToGroup } from './groupWrite.ts';
import { conflict, json, notFound, unauthorized } from './http.ts';
import {
  confirmLeaveStatements,
  deleteGroupStatements,
  isLastMember,
  loadCategoryIds,
  loadMembers,
  loadRuleMonthsAfter,
} from './membership.ts';
import { monthIn } from './months.ts';

// ---------------------------------------------------------------------------
// POST /groups/:id/leave

export async function handleRequestLeave(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  // バージョンが先。そのあとで、権限・メンバー・費目のデータを読む。
  const version = await readDataVersion(db, groupId);
  if (version === null) return notFound();
  const access = await loadGroupAccess(db, session.userId, groupId);
  if (access === null) return notFound();
  // すでに脱退が確定した（確定したものとして扱う月の終わりを含む）。
  if (isLeaveEffective(access, now)) return conflict('leave_confirmed');
  if (access.member.leaveRequestedMonth !== null) return conflict('leave_already_requested');

  const month = monthIn(access.group.timezone, now);
  const monthClosed = await isMonthClosed(db, groupId, month);
  const requested = (token: string) =>
    db
      .prepare(
        `UPDATE group_members SET leave_requested_month = ?
          WHERE id = ? AND group_id = ? AND status = 'active' AND leave_requested_month IS NULL
            AND EXISTS (${GROUP_WRITE_GUARD})`,
      )
      .bind(month, access.member.id, groupId, groupId, token);

  if (!monthClosed) {
    const written = await writeToGroup(db, groupId, version, (token) => [requested(token)]);
    if (!written.ok) return conflict('conflict');
    if (written.results[0]?.meta.changes !== 1) return conflict('conflict');
    return json({ leaveRequestedMonth: month, confirmed: false });
  }

  // 脱退月がすでに締められている。その場で確定する（5章）。
  const members = (await loadMembers(db, groupId)).map((member) =>
    member.id === access.member.id ? { ...member, leaveRequestedMonth: month } : member,
  );
  const due = members.filter((member) => member.id === access.member.id);
  if (isLastMember(members, due)) {
    // 最後の1人の脱退は、グループのデータをすべて消す（5章「グループの削除」）。利用者が、消えることを確認したときだけ。
    // 画面を読んだあとで、他のメンバーが脱退済みになった、など、確認の内容が古いときに、警告なしで消さない（`deleteAck.ts`）。
    if (!acknowledgesDelete(request)) return deleteNotAcknowledged();
    const deleted = await writeToGroup(db, groupId, version, (token) => deleteGroupStatements(db, token, groupId));
    if (!deleted.ok) return conflict('conflict');
    return json({ leaveRequestedMonth: month, confirmed: true, groupDeleted: true });
  }
  const categoryIds = await loadCategoryIds(db, groupId);
  const closedThrough = await latestClosedMonth(db, groupId);
  const ruleMonths = await loadRuleMonthsAfter(db, groupId, closedThrough);
  const written = await writeToGroup(db, groupId, version, (token) => [
    requested(token),
    ...confirmLeaveStatements(db, token, groupId, now, { members, due, categoryIds, closedThrough, ruleMonths }),
    // 関わる送金が無ければ、そのまま脱退済みになる。
    markLeftStatement(db, token, groupId, now, [access.member.id]),
  ]);
  if (!written.ok) return conflict('conflict');
  if (written.results[0]?.meta.changes !== 1) return conflict('conflict');
  return json({ leaveRequestedMonth: month, confirmed: true });
}

// ---------------------------------------------------------------------------
// DELETE /groups/:id/leave

export async function handleCancelLeave(request: Request, env: Env, now: number, groupId: string): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  const version = await readDataVersion(db, groupId);
  if (version === null) return notFound();
  const access = await loadGroupAccess(db, session.userId, groupId);
  if (access === null) return notFound();
  // 確定したあと（脱退月を締めた、または脱退月が終わった）は、取り消せない。
  if (isLeaveEffective(access, now)) return conflict('leave_confirmed');
  if (access.member.leaveRequestedMonth === null) return conflict('not_leaving');

  const written = await writeToGroup(db, groupId, version, (token) => [
    db
      .prepare(
        `UPDATE group_members SET leave_requested_month = NULL
          WHERE id = ? AND group_id = ? AND status = 'active' AND leave_requested_month IS NOT NULL
            AND EXISTS (${GROUP_WRITE_GUARD})`,
      )
      .bind(access.member.id, groupId, groupId, token),
  ]);
  if (!written.ok) return conflict('conflict');
  if (written.results[0]?.meta.changes !== 1) return conflict('conflict');
  return json({ leaveRequestedMonth: null });
}
