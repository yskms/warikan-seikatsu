// 月締め・精算完了・繰越のHTTP（POST /groups/:id/months/:month/close、POST /transfers/:id/settle、POST /transfers/:id/carry）。
// Serviceからだけ使う。形は docs/backend-design.md 9章の「月締め・精算API」が正で、Worker（worker/）とはコードを共有しない。
// 読み込み（月の一覧・集計）は `monthRepository.ts`。ここは書き込みだけ。
//
// - 書き込み（`POST`）の応答は、**使う項目だけ**を検べる（CLAUDE.md）。月締めは、`groupDeleted`（最後の1人の脱退で、締めずに
//   グループを消した）かどうかと、それ以外のとき `closed` が true であること（JSONでない200を、成功と取り違えないための最低限）。
//   締めた結果（`MonthView`）は読まない: 画面は、締めたあとにホームの読み込みで結果を取り直す。精算・繰越は、`transfer.id` だけ。
// - 断られたとき（400・403・404・409）は、`SettlementRejectedError`（`AuthError` の `invalid-request`）に、サーバーが返した
//   理由を載せる。画面が、「他のメンバーが先に締めた」「繰り越せない送金」などを出し分けるため（`src/services/settlementMessage.ts`）。
// - 再試行はしない。月締めも精算も、結果が分からないまま同じ操作を送り直しても、二重にはならない（すでに済んでいれば
//   409 `month_closed`・`transfer_not_pending` で断られるだけ）。
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { bool, id, month, record } from './parse.ts';

export type SettlementFetchLike = ApiFetchLike;

/**
 * 書き込みをサーバーが断った（400・403・404・409）。`code` は `invalid-request`。理由（`reason`。サーバーの `error`）によって、
 * 画面の案内を変える。値は、形を確かめられたものだけを載せる（無ければ `null`）。
 */
export class SettlementRejectedError extends AuthError {
  readonly status: number;
  /** サーバーの `error`（`conflict`・`month_closed`・`previous_month_unsettled`・`transfer_not_pending` など） */
  readonly reason: string | null;
  /** `previous_month_not_closed`・`previous_month_unsettled` の、先に済ませる月（`YYYY-MM`） */
  readonly month: string | null;
  /** `transfer_not_pending` の、いまの状態（`settled`・`carried`。知らない値も文字列のまま） */
  readonly transferStatus: string | null;

  constructor(status: number, detail: Partial<Pick<SettlementRejectedError, 'reason' | 'month' | 'transferStatus'>>) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'SettlementRejectedError';
    this.status = status;
    this.reason = detail.reason ?? null;
    this.month = detail.month ?? null;
    this.transferStatus = detail.transferStatus ?? null;
  }
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

function optionalMonth(value: unknown): string | null {
  return typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null;
}

async function rejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  const data = record(await response.json());
  return new SettlementRejectedError(status, {
    reason: optionalString(data.error),
    month: optionalMonth(data.month),
    transferStatus: optionalString(data.status),
  });
}

/**
 * 月締めの結果。`group-deleted` は、この月を脱退月に選んだ最後の1人が抜けるため、締めずにグループのデータをすべて消した
 * （200 `{ groupDeleted: true }`。docs/backend-design.md 5章）。
 */
export type CloseResult = { kind: 'closed' } | { kind: 'group-deleted' };

export function createSettlementRepository(
  fetchImpl: SettlementFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  function transferPath(transferId: string, action: 'settle' | 'carry'): string {
    return `/transfers/${encodeURIComponent(transferId)}/${action}`;
  }

  /** 精算・繰越の応答から、`transfer.id` だけを読む（書き込みの応答は、使う項目だけを検べる） */
  async function processedTransferId(response: { json(): Promise<unknown> }): Promise<{ id: string }> {
    return { id: id(record(record(await response.json()).transfer).id) };
  }

  return {
    /**
     * `POST /groups/:id/months/:month/close`。締めた（201）、またはグループごと消した（200 `groupDeleted`）。
     * やり直さない（競合したら 409 `conflict`。確認の内容が変わりうるため）。断られたら `SettlementRejectedError`。
     * `targetMonth` は呼び出し側が検べた `YYYY-MM`（パスに入れるので、形が違えば失敗にする）。
     */
    async close(session: string, groupId: string, targetMonth: string): Promise<CloseResult> {
      const path = `/groups/${encodeURIComponent(groupId)}/months/${month(targetMonth)}/close`;
      return client.request('POST', path, { session, rejected: rejection }, async (response) => {
        const data = record(await response.json());
        if (data.groupDeleted === true) return { kind: 'group-deleted' };
        // 締めた月の結果が返る（`closed: true`）。ほかの項目は読まない
        if (!bool(data.closed)) throw new AuthError('invalid-response');
        return { kind: 'closed' };
      });
    },

    /** `POST /transfers/:id/settle`。精算済みにする（確定後は戻せない）。断られたら `SettlementRejectedError`。 */
    settle(session: string, transferId: string): Promise<{ id: string }> {
      return client.request('POST', transferPath(transferId, 'settle'), { session, rejected: rejection }, processedTransferId);
    },

    /** `POST /transfers/:id/carry`。次の月に繰り越す（確定後は戻せない）。断られたら `SettlementRejectedError`。 */
    carry(session: string, transferId: string): Promise<{ id: string }> {
      return client.request('POST', transferPath(transferId, 'carry'), { session, rejected: rejection }, processedTransferId);
    },
  };
}

export type SettlementRepository = ReturnType<typeof createSettlementRepository>;
