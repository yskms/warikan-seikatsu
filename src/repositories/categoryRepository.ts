// 費目の一覧のHTTP（GET /groups/:id/categories）。Serviceからだけ使う。形は docs/backend-design.md 9章の
// 「費目・負担割合API」が正で、Worker（worker/）とはコードを共有しない。作成・変更・並べ替えは、費目の画面を作るときに足す。
// 読み込みなので、使う項目を全部検べる。
import type { Category } from '../domain/month.ts';
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { array, id, int, nullableInt, record, str } from './parse.ts';

export type CategoryFetchLike = ApiFetchLike;

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
  };
}

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;
