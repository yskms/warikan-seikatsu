// 月次集計（summary）、月締め、締め結果。リクエスト・レスポンスの形は docs/backend-design.md 9章「月締め・精算API」、
// 規則は同3章（月次集計）・4章（月締め）・8章（競合制御）。
//
// - summary は、締める前の月は現在の支出から計算した「見込み」、締めた月は締めた時点の結果を返す。
//   見込みも締めも `computeMonthFromState`（同じ読み込み・同じ計算）を使うので、締めた結果は、直前の見込みと
//   一致する（間に別の書き込みが入れば、バージョンが変わって締めは失敗する）。
// - 月締めの中で、この月を脱退月に選んでいるメンバーの脱退も確定する（membership.ts。5章）。最後の1人なら、
//   締めずにグループを削除して、200 `{ groupDeleted: true }` を返す。ただし、利用者の申告（`acknowledgeDelete=true`。
//   `deleteAck.ts`）が無ければ、何も消さずに409 `delete_not_acknowledged` を返す。
// - 月締めは、やり直さずに409を返す（4章・8章「競合したとき」。確認ダイアログの内容が変わりうるため）。
//   バージョンを先に読み、そのあとで権限・状態・集計のデータを読む（groupWrite.ts 冒頭の注意1）。
import { authenticateRequest, canViewMonth, loadGroupAccess } from './access.ts';
import { loadClosedMonth, markLeftStatement } from './closedMonth.ts';
import { acknowledgesDelete, deleteNotAcknowledged } from './deleteAck.ts';
import { insertRowsGuarded, readDataVersion, writeToGroup } from './groupWrite.ts';
import { conflict, forbidden, json, notFound, unauthorized } from './http.ts';
import {
  closeDeletesGroup,
  confirmEndedLeaves,
  confirmLeaveStatements,
  deleteGroupStatements,
  dueLeaves,
  loadCategoryIds,
  loadRuleMonthsAfter,
} from './membership.ts';
import { computeMonthFromState, evaluateClose, loadMonthState, type CloseBlock } from './monthState.ts';

/** 締められない理由の応答。`forbidden` は403、それ以外は409（エラー名は理由と同じ）。 */
function closeBlockResponse(block: CloseBlock): Response {
  if (block.reason === 'forbidden') return forbidden();
  return conflict(block.reason, 'month' in block ? { month: block.month } : {});
}

// ---------------------------------------------------------------------------
// GET /groups/:id/months/:month/summary

export async function handleMonthSummary(
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
  if (!canViewMonth(access, month)) return forbidden();

  const state = await loadMonthState(db, groupId, month);
  const closing = state.closings.find((item) => item.month === month);
  if (closing !== undefined) {
    const view = await loadClosedMonth(db, groupId, closing.id);
    if (view === null) return notFound();
    return json({ ...view, close: { closable: false, reason: 'month_closed' } });
  }

  const { result, totalMinor } = computeMonthFromState(state, month);
  const block = evaluateClose(state, access, month, now);
  return json({
    month,
    closed: false,
    closing: null,
    totalMinor,
    members: result.members.map((member) => ({
      memberId: member.memberId,
      displayName: state.members.get(member.memberId)?.displayName ?? '',
      paidMinor: member.paidMinor,
      burdenMinor: member.burdenMinor,
      differenceMinor: member.differenceMinor,
      carriedInMinor: member.carriedInMinor,
      netMinor: member.netMinor,
    })),
    categories: result.categories.map((category) => ({
      categoryId: category.categoryId,
      totalMinor: category.totalMinor,
      burdens: category.burdens.map((burden) => ({ memberId: burden.memberId, burdenMinor: burden.amount })),
    })),
    // 見込み。締めるまで確定しないので、IDも状態も無い。
    transfers: result.transfers,
    // `deletesGroup`: 締めると、締めずにグループのデータがすべて消える（最後の1人の脱退が確定する）。アプリが、締める前の
    // 確認で警告を出すための値で、最後の1人かの規則をアプリに書き写さないために返す（`closeDeletesGroup`）。
    close:
      block === null
        ? {
            closable: true,
            deletesGroup: closeDeletesGroup([...state.members.values()], month),
          }
        : { closable: false, ...block },
  });
}

// ---------------------------------------------------------------------------
// GET /groups/:id/months/:month/closing

export async function handleGetClosing(
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
  if (!canViewMonth(access, month)) return forbidden();

  const row = await db
    .prepare('SELECT id FROM monthly_closings WHERE group_id = ? AND target_month = ?')
    .bind(groupId, month)
    .first<{ id: string }>();
  if (row === null) return json({ error: 'not_closed' }, 404);
  const view = await loadClosedMonth(db, groupId, row.id);
  return view === null ? json({ error: 'not_closed' }, 404) : json(view);
}

// ---------------------------------------------------------------------------
// POST /groups/:id/months/:month/close

export async function handleCloseMonth(
  request: Request,
  env: Env,
  now: number,
  groupId: string,
  month: string,
): Promise<Response> {
  const session = await authenticateRequest(request, env.DB, now);
  if (session === null) return unauthorized();
  const db = env.DB;

  // バージョンが先。そのあとで、権限・状態・集計のデータを読む。
  const version = await readDataVersion(db, groupId);
  if (version === null) return notFound();
  const access = await loadGroupAccess(db, session.userId, groupId);
  if (access === null) return notFound();
  const state = await loadMonthState(db, groupId, month);
  const block = evaluateClose(state, access, month, now);
  if (block !== null) return closeBlockResponse(block);

  // この月を脱退月に選んでいるメンバーの脱退は、月を締めたときに確定する（5章）。
  const members = [...state.members.values()];
  const due = dueLeaves(members, month);
  if (due.some((member) => member.leaveRequestedMonth! < month)) {
    // 脱退月が、この月より前なのに、確定していない。脱退月が、最初の締めで飛ばされた月のときに起きる（飛ばした月は、
    // 締められないので、締めで確定する機会が無い）。このまま締めると、確定の前の割合で計算し、脱退した人に負担が付く。
    // 先に、Cronと同じ処理で確定させる（この月の割合から、脱退した人が外れる）。確定のあとは、集計が変わるので、
    // 締めずに409を返し、読み直してもらう。この確定が、グループを消すことは無い（その脱退者は、最後の1人にならない。
    // `closeDeletesGroup` の説明）ので、読み直しが404になることは無い。
    await confirmEndedLeaves(db, groupId, now);
    return conflict('conflict');
  }
  if (closeDeletesGroup(members, month)) {
    // 最後の1人が抜けるときは、締めずに、グループのデータをすべて消す（5章「グループの削除」）。利用者が、消えることを確認した
    // ときだけ。確認のシートを開いたあとで、他のメンバーが脱退済みになった、など、確認の内容が古いときに、通常の締めのつもりの
    // 利用者のグループを、警告なしで消さない（`deleteAck.ts`）。
    if (!acknowledgesDelete(request)) return deleteNotAcknowledged();
    const deleted = await writeToGroup(db, groupId, version, (token) => deleteGroupStatements(db, token, groupId));
    if (!deleted.ok) return conflict('conflict');
    return json({ groupDeleted: true });
  }
  const categoryIds = due.length === 0 ? [] : await loadCategoryIds(db, groupId);
  // 割合のリセットは、いま締める月より後の月だけ（その月より後に行がある月も、あわせて直す）。
  const ruleMonths = due.length === 0 ? [] : await loadRuleMonthsAfter(db, groupId, month);

  const { result } = computeMonthFromState(state, month);
  const closingId = crypto.randomUUID();
  const nameOf = (memberId: string) => state.members.get(memberId)?.displayName ?? '';

  // 月の行が無い費目は、引き継いだ設定をこの月の行として書き、確定値として残す（3章）。
  const inheritedSettings: (string | number | null)[][] = [];
  const inheritedShares: (string | number | null)[][] = [];
  // アーカイブした費目は、その月に支出がなければ書かない（毎月、使わない行が増え続けるのを避ける）。設定は、
  // 引き継ぐ元の行がそのまま使われる。アーカイブした費目の支出を未締めの月へ移しても、同じ。
  const usedCategories = new Set(result.categories.map((category) => category.categoryId));
  for (const [categoryId, source] of state.rules) {
    if (source.sourceMonth >= month) continue;
    if (source.archived && !usedCategories.has(categoryId)) continue;
    const cap = source.rule.cap ?? null;
    // 見直しのお知らせの印（`member_changed_at`・`member_changed_kind`）も写す。写さないと、月を締めただけで、見直していない
    // 割合のお知らせが消える（種類も写さないと、「0%で足した」お知らせが、「均等に戻した」の文言に変わる）。
    inheritedSettings.push([
      groupId,
      categoryId,
      month,
      cap?.memberId ?? null,
      cap?.capMinor ?? null,
      source.memberChangedAt,
      source.memberChangedKind,
    ]);
    for (const share of source.rule.shares) {
      inheritedShares.push([groupId, categoryId, month, share.memberId, share.basisPoints]);
    }
  }

  const written = await writeToGroup(db, groupId, version, (token) => [
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_settings',
      ['group_id', 'category_id', 'target_month', 'cap_member_id', 'cap_minor', 'member_changed_at', 'member_changed_kind'],
      inheritedSettings,
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'category_month_shares',
      ['group_id', 'category_id', 'target_month', 'member_id', 'share_basis_points'],
      inheritedShares,
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'monthly_closings',
      [
        'id',
        'group_id',
        'target_month',
        'currency_code',
        'currency_minor_unit',
        'data_version',
        'closed_by_member_id',
        'closed_at',
      ],
      // data_version は、この書き込みで上がった後のバージョン。
      [
        [
          closingId,
          groupId,
          month,
          access.group.currencyCode,
          access.group.currencyMinorUnit,
          version + 1,
          access.member.id,
          now,
        ],
      ],
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'closing_member_summaries',
      [
        'group_id',
        'closing_id',
        'member_id',
        'display_name_snapshot',
        'paid_minor',
        'burden_minor',
        'difference_minor',
        'carried_in_minor',
        'net_minor',
      ],
      result.members.map((member) => [
        groupId,
        closingId,
        member.memberId,
        nameOf(member.memberId),
        member.paidMinor,
        member.burdenMinor,
        member.differenceMinor,
        member.carriedInMinor,
        member.netMinor,
      ]),
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'closing_category_burdens',
      ['group_id', 'closing_id', 'category_id', 'member_id', 'total_minor', 'burden_minor'],
      result.categories.flatMap((category) =>
        category.burdens.map((burden) => [
          groupId,
          closingId,
          category.categoryId,
          burden.memberId,
          category.totalMinor,
          burden.amount,
        ]),
      ),
    ),
    ...insertRowsGuarded(
      db,
      token,
      groupId,
      'settlement_transfers',
      ['id', 'group_id', 'closing_id', 'from_member_id', 'to_member_id', 'amount_minor'],
      result.transfers.map((transfer) => [
        crypto.randomUUID(),
        groupId,
        closingId,
        transfer.fromMemberId,
        transfer.toMemberId,
        transfer.amountMinor,
      ]),
    ),
    // 脱退の確定（送金は、上で作ったあと）。確定したメンバーで、送金が0件の人は、続く文で脱退済みになる。
    ...confirmLeaveStatements(db, token, groupId, now, { members, due, categoryIds, closedThrough: month, ruleMonths }),
    // 脱退が確定していて、送金が0件のメンバーは、締めた時点で脱退済みにする（5章）。
    markLeftStatement(db, token, groupId, now, null),
  ]);
  // 'version'（他のリクエストが先に書いた）も 'unique' も、やり直さない（8章）。アプリは読み直す。
  if (!written.ok) return conflict('conflict');

  const view = await loadClosedMonth(db, groupId, closingId);
  return view === null ? notFound() : json(view, 201);
}
