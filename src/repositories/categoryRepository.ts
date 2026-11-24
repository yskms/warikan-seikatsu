// 費目のHTTP（一覧・作成・変更・並べ替え）。Serviceからだけ使う。形は docs/backend-design.md 9章の「費目・負担割合API」が
// 正で、Worker（worker/）とはコードを共有しない。月ごとの負担割合は `categorySharesRepository.ts`。
//
// - 読み込み（`GET`）は、使う項目を全部検べる。
// - 書き込み（`POST`・`PATCH`・`PUT`）の応答は、**使う項目だけ**を検べる（CLAUDE.md）。作成・変更は `category.id`、並べ替えは
//   `categories` が配列であること（JSONでない200を成功と取り違えないための最低限）。応答の費目の全項目は読まない:
//   保存したあとは、画面が一覧を読み直して取り直す。
// - 書き込みが断られたとき（400・403・404・409）は、`CategoryRejectedError`（`AuthError` の `invalid-request`）に、サーバーが
//   返した理由を載せる。負担割合の保存（`categorySharesRepository.ts`）も、これを使う。画面が「月が締められた」「メンバーが
//   変わった」などを出し分けるため（`src/services/categoryMessage.ts`）。
// - 作成の `id`（冪等キー）は、呼び出し側が作る。同じ `id` の再送は、保存済みの費目を返す（200）ので、結果が分からない失敗の
//   あとに、同じ `id` で送り直してよい。変更・並べ替えは、同じ内容を送り直しても同じ結果。
import type { Category } from '../domain/month.ts';
import { createApiClient, isOpaqueValue, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { array, id, int, nullableInt, record, str } from './parse.ts';

export type CategoryFetchLike = ApiFetchLike;

/**
 * 書き込みをサーバーが断った（400・403・404・409）。`code` は `invalid-request`。やり直しても同じ結果になる失敗で、
 * 理由（`reason`。サーバーの `error`）によって、画面の案内を変える。値は、形を確かめられたものだけを載せる（無ければ `null`）。
 */
export class CategoryRejectedError extends AuthError {
  readonly status: number;
  /** サーバーの `error`（`too_many_categories`・`categories_changed`・`month_closed`・`members_changed` など） */
  readonly reason: string | null;
  /** 400 のとき、直すべき項目（`name`・`shares`・`cap.capMinor` など） */
  readonly field: string | null;
  /** `month_not_editable` の、直せる範囲（`YYYY-MM`） */
  readonly from: string | null;
  readonly to: string | null;
  /** `members_changed` の、いま必要なメンバー */
  readonly memberIds: string[] | null;

  constructor(
    status: number,
    detail: Partial<Pick<CategoryRejectedError, 'reason' | 'field' | 'from' | 'to' | 'memberIds'>>,
  ) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'CategoryRejectedError';
    this.status = status;
    this.reason = detail.reason ?? null;
    this.field = detail.field ?? null;
    this.from = detail.from ?? null;
    this.to = detail.to ?? null;
    this.memberIds = detail.memberIds ?? null;
  }
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 ? value : null;
}

function optionalMonth(value: unknown): string | null {
  return typeof value === 'string' && MONTH_PATTERN.test(value) ? value : null;
}

function optionalIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isOpaqueValue) ? (value as string[]) : null;
}

/** 書き込みの断り（400・403・404・409）から、`CategoryRejectedError` を作る。`ApiRequestInit.rejected` に渡す。 */
export async function categoryRejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  const data = record(await response.json());
  return new CategoryRejectedError(status, {
    reason: optionalString(data.error),
    field: optionalString(data.field),
    from: optionalMonth(data.from),
    to: optionalMonth(data.to),
    memberIds: optionalIds(data.memberIds),
  });
}

/** 費目の作成の入力（`name`・`icon`・`color` は必須。`id` は、作成の識別子。小文字のUUID） */
export interface CreateCategoryInput {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** 費目の変更の入力（変えるものだけ。1つ以上） */
export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  archived?: boolean;
}

function parseCategory(value: unknown): Category {
  const data = record(value);
  return {
    id: id(data.id),
    name: str(data.name),
    icon: str(data.icon),
    color: str(data.color),
    sortOrder: int(data.sortOrder),
    // アーカイブした日時。日時そのものは使わず、アーカイブしているかだけを持つ
    archived: nullableInt(data.archivedAt) !== null,
  };
}

/** 作成・変更の応答から、`category.id` だけを読む（書き込みの応答は、使う項目だけを検べる） */
async function categoryId(response: { json(): Promise<unknown> }): Promise<{ id: string }> {
  return { id: id(record(record(await response.json()).category).id) };
}

export function createCategoryRepository(
  fetchImpl: CategoryFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /** `GET /groups/:id/categories`。並び順（`sortOrder`、`id`）。アーカイブした費目も含む。 */
    list(session: string, groupId: string): Promise<Category[]> {
      return client.request('GET', `/groups/${encodeURIComponent(groupId)}/categories`, { session }, async (response) => {
        const data = record(await response.json());
        return array(data.categories).map(parseCategory);
      });
    },

    /**
     * `POST /groups/:id/categories`。新しい費目の `sortOrder` は、いまの最大の次。月の設定と割合も、サーバーが同じ書き込みで
     * 書く。同じ `id` の再送は、保存済みの費目を返す（200）。使うのは `category.id` だけ。断られたら `CategoryRejectedError`。
     */
    create(session: string, groupId: string, input: CreateCategoryInput): Promise<{ id: string }> {
      return client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/categories`,
        { session, json: { id: input.id, name: input.name, icon: input.icon, color: input.color }, rejected: categoryRejection },
        categoryId,
      );
    },

    /**
     * `PATCH /categories/:id`。変えるものだけを送る（アーカイブ・戻すも `archived`）。使うのは `category.id` だけ。
     * 断られたら `CategoryRejectedError`。
     */
    update(session: string, categoryIdValue: string, input: UpdateCategoryInput): Promise<{ id: string }> {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.icon !== undefined) body.icon = input.icon;
      if (input.color !== undefined) body.color = input.color;
      if (input.archived !== undefined) body.archived = input.archived;
      return client.request(
        'PATCH',
        `/categories/${encodeURIComponent(categoryIdValue)}`,
        { session, json: body, rejected: categoryRejection },
        categoryId,
      );
    },

    /**
     * `PUT /groups/:id/categories/order`。グループの全費目（アーカイブ済みも含む）を、並べたい順に送る。読んだあとに
     * 費目が増えた・知らないIDがある、で合わなければ 409 `categories_changed`（読み直してもらう）。応答の費目は読まない
     * （配列であることだけ確かめる）。断られたら `CategoryRejectedError`。
     */
    async reorder(session: string, groupId: string, categoryIds: string[]): Promise<void> {
      await client.request(
        'PUT',
        `/groups/${encodeURIComponent(groupId)}/categories/order`,
        { session, json: { categoryIds }, rejected: categoryRejection },
        async (response) => {
          array(record(await response.json()).categories);
        },
      );
    },
  };
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;
