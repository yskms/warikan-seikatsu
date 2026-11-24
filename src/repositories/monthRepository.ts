// 月の一覧・月の集計（精算）のHTTP（GET /groups/:id/months、GET /groups/:id/months/:month/summary）。Serviceからだけ使う。
// 形は docs/backend-design.md 9章の「月締め・精算API」が正で、Worker（worker/）とはコードを共有しない。
// 読み込みなので、使う項目を全部検べる（形の違う応答は `invalid-response`。`groupRepository.ts` の先頭と同じ方針）。
// ただし、表示にしか使わない列挙値（月の `status`、`close.reason`）は、知らない値を許す（`parse.ts` の `oneOfOrUnknown`。CLAUDE.md）。
// 送金の `status`・`canCarry` は、操作の可否に関わるので、厳密に検べる。
import {
  CLOSE_BLOCK_REASONS,
  MONTH_STATUSES,
  TRANSFER_STATUSES,
  type CloseState,
  type MonthCategory,
  type MonthList,
  type MonthMember,
  type MonthTransfer,
  type MonthView,
} from '../domain/month.ts';
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { array, bool, id, int, invalid, month, oneOf, oneOfOrUnknown, record, str } from './parse.ts';

export type MonthFetchLike = ApiFetchLike;

function parseMember(value: unknown): MonthMember {
  const data = record(value);
  return {
    memberId: id(data.memberId),
    displayName: str(data.displayName),
    paidMinor: int(data.paidMinor),
    burdenMinor: int(data.burdenMinor),
    differenceMinor: int(data.differenceMinor),
    carriedInMinor: int(data.carriedInMinor),
    netMinor: int(data.netMinor),
  };
}

function parseCategory(value: unknown): MonthCategory {
  const data = record(value);
  return {
    categoryId: id(data.categoryId),
    totalMinor: int(data.totalMinor),
    burdens: array(data.burdens).map((burden) => {
      const row = record(burden);
      return { memberId: id(row.memberId), burdenMinor: int(row.burdenMinor) };
    }),
  };
}

/** 締める前の月（`closed: false`）の送金は見込み（IDも状態も無い）。締めた月の送金は、送金ごとに状態つき。 */
function parseTransfer(value: unknown, closed: boolean): MonthTransfer {
  const data = record(value);
  const common = {
    fromMemberId: id(data.fromMemberId),
    toMemberId: id(data.toMemberId),
    amountMinor: int(data.amountMinor),
  };
  if (!closed) return { kind: 'estimate', ...common };
  return {
    kind: 'closed',
    id: id(data.id),
    ...common,
    status: oneOf(TRANSFER_STATUSES, data.status),
    canCarry: bool(data.canCarry),
  };
}

function parseClose(value: unknown): CloseState {
  const data = record(value);
  // `deletesGroup` は、締める前の警告に使う（取り消せない削除の直前に出す）。読めなければ、警告が出ないまま締めさせてしまうので、
  // 失敗にする（読み込みなので、何も変わらない）。
  if (bool(data.closable)) return { closable: true, deletesGroup: bool(data.deletesGroup) };
  return {
    closable: false,
    // 文言の出し分けにしか使わないので、知らない理由は失敗にしない
    reason: oneOfOrUnknown(CLOSE_BLOCK_REASONS, data.reason),
    // 前の月の2つの理由のときだけ付く（先に済ませる月）
    month: data.month === undefined ? null : month(data.month),
  };
}

function parseMonthView(value: unknown): MonthView {
  const data = record(value);
  const closed = bool(data.closed);
  const closing = data.closing === null ? null : record(data.closing);
  // 締めた月だけ `closing` がある（締めた月の結果は、締めた記録なしには成り立たない）
  if (closed !== (closing !== null)) invalid();
  return {
    month: month(data.month),
    closed,
    closing:
      closing === null
        ? null
        : {
            id: id(closing.id),
            closedAt: int(closing.closedAt),
            closedByMemberId: id(closing.closedByMemberId),
            processed: bool(closing.processed),
          },
    totalMinor: int(data.totalMinor),
    members: array(data.members).map(parseMember),
    categories: array(data.categories).map(parseCategory),
    transfers: array(data.transfers).map((transfer) => parseTransfer(transfer, closed)),
    close: parseClose(data.close),
  };
}

export function createMonthRepository(
  fetchImpl: MonthFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /** `GET /groups/:id/months`。ホームの月ピッカー用（選べる月と、月ごとの状態）。 */
    async list(session: string, groupId: string): Promise<MonthList> {
      return client.request('GET', `/groups/${encodeURIComponent(groupId)}/months`, { session }, async (response) => {
        const data = record(await response.json());
        return {
          currentMonth: month(data.currentMonth),
          months: array(data.months).map((item) => {
            const row = record(item);
            // 表示にしか使わないので、知らない状態は失敗にしない
            return { month: month(row.month), status: oneOfOrUnknown(MONTH_STATUSES, row.status) };
          }),
        };
      });
    },

    /**
     * `GET /groups/:id/months/:month/summary`。締める前は、いまの支出から計算した見込み（前の月からの繰越を足す）。
     * 締めた月は、締めた時点の結果。`month` は呼び出し側が検べた `YYYY-MM`（パスに入れるので、形が違えば失敗にする）。
     */
    async summary(session: string, groupId: string, targetMonth: string): Promise<MonthView> {
      const path = `/groups/${encodeURIComponent(groupId)}/months/${month(targetMonth)}/summary`;
      return client.request('GET', path, { session }, async (response) => {
        const view = parseMonthView(await response.json());
        // 別の月の結果が返ったら、その月の画面に出さない
        if (view.month !== targetMonth) invalid();
        return view;
      });
    },
  };
}

export type MonthRepository = ReturnType<typeof createMonthRepository>;
