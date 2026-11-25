// 月ごとの費目の負担割合のHTTP（GET・PUT /groups/:id/months/:month/category-shares）。Serviceからだけ使う。形は
// docs/backend-design.md 9章の「費目・負担割合API」が正で、Worker（worker/）とはコードを共有しない。
//
// - 読み込み（`GET`）は、使う項目を全部検べる（形の違う応答は `invalid-response`）。
// - 書き込み（`PUT`）の応答は、**使う項目だけ**を検べる（CLAUDE.md）。使うのは `overriddenMonths`（「X月以降は別の設定が
//   あります」の案内）だけ。応答の `rule` は読まない: 保存したあとは、画面が読み直して取り直す。`overriddenMonths` が
//   読めないときは、保存は済んでいるので、失敗にせず「案内する月なし」にする（案内が出ないだけ。同じ内容で送り直しても
//   同じ結果で、利用者に失敗に見せる理由がない）。ただし、JSONでない200（宿のWi-Fiの認証画面など）を成功と取り違えないよう、
//   応答がオブジェクトであることだけは確かめる。
// - 断られたとき（400・403・404・409）は、`CategoryRejectedError` に、サーバーが返した理由を載せる（`categoryRepository.ts`）。
// - 見直しの確認（`POST .../category-shares/acknowledge-reset`。204）は、本文を読まない。同じ確認を送り直しても同じ（印が無いだけ）。
// - 再試行はしない。割合は置き換えなので、送り直しても二重にはならない。
import type { CategoryShareRule, CategoryShares, SavedCategoryShare, ShareCap } from '../domain/categoryShare.ts';
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { categoryRejection } from './categoryRepository.ts';
import { array, bool, id, int, invalid, month, record } from './parse.ts';

export type CategorySharesFetchLike = ApiFetchLike;

function parseRule(value: unknown): CategoryShareRule {
  const data = record(value);
  const cap = data.cap === null ? null : record(data.cap);
  return {
    categoryId: id(data.categoryId),
    sourceMonth: month(data.sourceMonth),
    shares: array(data.shares).map((item) => {
      const row = record(item);
      return { memberId: id(row.memberId), basisPoints: int(row.basisPoints) };
    }),
    cap: cap === null ? null : { memberId: id(cap.memberId), capMinor: int(cap.capMinor) },
    archived: bool(data.archived),
    memberChangedAt: data.memberChangedAt === null ? null : int(data.memberChangedAt),
  };
}

/** 保存する割合。`shares` は、その月のメンバー全員を、合計10000で。 */
export interface SaveShareInput {
  shares: { memberId: string; basisPoints: number }[];
  /** 上限額つきにするとき。外すときは `null` */
  cap: ShareCap | null;
  /** 上限額を入力したときの通貨（グループの通貨と違えば409 `currency_mismatch`）。上限額なしなら送らない */
  currencyCode: string | null;
}

/** `overriddenMonths` を読む。形が違えば、案内する月なし（上の注記）。 */
function overriddenMonths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(item));
}

export function createCategorySharesRepository(
  fetchImpl: CategorySharesFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  function path(groupId: string, targetMonth: string): string {
    return `/groups/${encodeURIComponent(groupId)}/months/${month(targetMonth)}/category-shares`;
  }

  return {
    /** `GET .../category-shares`。割合が1つも無い費目（作る前の月）は含まれない。 */
    async get(session: string, groupId: string, targetMonth: string): Promise<CategoryShares> {
      return client.request('GET', path(groupId, targetMonth), { session }, async (response) => {
        const data = record(await response.json());
        const result: CategoryShares = {
          month: month(data.month),
          closed: bool(data.closed),
          editable: bool(data.editable),
          memberIds: array(data.memberIds).map(id),
          categories: array(data.categories).map(parseRule),
        };
        // 別の月の結果が返ったら、その月の画面に出さない
        if (result.month !== targetMonth) invalid();
        return result;
      });
    },

    /**
     * `PUT .../category-shares/:categoryId`。その月の割合を、置き換える（選んだ月とそれ以降に効く。後の月に別の行が
     * あれば、その月は書き換えず `overriddenMonths` に入る）。断られたら `CategoryRejectedError`。
     */
    async put(
      session: string,
      groupId: string,
      targetMonth: string,
      categoryId: string,
      input: SaveShareInput,
    ): Promise<SavedCategoryShare> {
      const body: Record<string, unknown> = {
        shares: input.shares.map((share) => ({ memberId: share.memberId, basisPoints: share.basisPoints })),
      };
      if (input.cap !== null) {
        body.cap = { memberId: input.cap.memberId, capMinor: input.cap.capMinor };
        if (input.currencyCode !== null) body.currencyCode = input.currencyCode;
      }
      return client.request(
        'PUT',
        `${path(groupId, targetMonth)}/${encodeURIComponent(categoryId)}`,
        { session, json: body, rejected: categoryRejection },
        async (response) => {
          const data = record(await response.json());
          return { overriddenMonths: overriddenMonths(data.overriddenMonths) };
        },
      );
    },

    /**
     * `POST /groups/:id/category-shares/acknowledge-reset`（204）。「メンバーが変わったため、割合を均等に戻した」お知らせを、
     * 見直し済みにする（割合は変えない）。`through` は、画面が見た最も新しい `memberChangedAt`（それより新しい印は、見て
     * いないので消えない）。本文は読まない。断られたら `CategoryRejectedError`。
     */
    async acknowledgeReset(session: string, groupId: string, through: number): Promise<void> {
      await client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/category-shares/acknowledge-reset`,
        { session, json: { through }, rejected: categoryRejection },
        async () => undefined,
      );
    },
  };
}

export type CategorySharesRepository = ReturnType<typeof createCategorySharesRepository>;
