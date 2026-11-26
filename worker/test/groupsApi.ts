// グループ・費目・月ごとの負担割合のAPIのテストで使う、呼び出しの道具（monthApi.ts と同じ作り）。
import {
  handleAcknowledgeSharesReset,
  handleCreateCategory,
  handleGetCategoryRules,
  handleListCategories,
  handlePutCategoryRule,
  handleReorderCategories,
  handleResetSharesToEqual,
  handleUpdateCategory,
} from '../src/categories.ts';
import { handleCreateGroup, handleGetGroup, handleListGroups, handleUpdateGroup, handleUpdateMe } from '../src/groups.ts';
import { NOW, type Person } from './apiFixture.ts';
import { read, request, type ApiResult } from './monthApi.ts';

interface Options {
  now?: number;
  env?: Env;
}

/** 各APIの呼び出し。`who` が null なら、セッション無し。 */
export function groupsApi(defaultEnv: Env) {
  const opts = (options: Options) => [options.env ?? defaultEnv, options.now ?? NOW] as const;
  const token = (who: Person | null) => who?.token ?? null;
  return {
    createGroup: async (who: Person | null, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleCreateGroup(request('POST', '/groups', token(who), body), ...opts(options))),
    listGroups: async (who: Person | null, options: Options = {}): Promise<ApiResult> =>
      read(await handleListGroups(request('GET', '/groups', token(who)), ...opts(options))),
    getGroup: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleGetGroup(request('GET', `/groups/${groupId}`, token(who)), ...opts(options), groupId)),
    updateGroup: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleUpdateGroup(request('PATCH', `/groups/${groupId}`, token(who), body), ...opts(options), groupId)),
    updateMe: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleUpdateMe(request('PATCH', `/groups/${groupId}/members/me`, token(who), body), ...opts(options), groupId)),
    listCategories: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleListCategories(request('GET', `/groups/${groupId}/categories`, token(who)), ...opts(options), groupId)),
    createCategory: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleCreateCategory(request('POST', `/groups/${groupId}/categories`, token(who), body), ...opts(options), groupId)),
    updateCategory: async (who: Person | null, categoryId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleUpdateCategory(request('PATCH', `/categories/${categoryId}`, token(who), body), ...opts(options), categoryId)),
    reorderCategories: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(await handleReorderCategories(request('PUT', `/groups/${groupId}/categories/order`, token(who), body), ...opts(options), groupId)),
    getRules: async (who: Person | null, groupId: string, month: string, options: Options = {}): Promise<ApiResult> =>
      read(
        await handleGetCategoryRules(
          request('GET', `/groups/${groupId}/months/${month}/category-shares`, token(who)),
          ...opts(options),
          groupId,
          month,
        ),
      ),
    acknowledgeReset: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(
        await handleAcknowledgeSharesReset(
          request('POST', `/groups/${groupId}/category-shares/acknowledge-reset`, token(who), body),
          ...opts(options),
          groupId,
        ),
      ),
    resetSharesToEqual: async (who: Person | null, groupId: string, body: unknown, options: Options = {}): Promise<ApiResult> =>
      read(
        await handleResetSharesToEqual(
          request('POST', `/groups/${groupId}/category-shares/reset-equal`, token(who), body),
          ...opts(options),
          groupId,
        ),
      ),
    putRule: async (
      who: Person | null,
      groupId: string,
      month: string,
      categoryId: string,
      body: unknown,
      options: Options = {},
    ): Promise<ApiResult> =>
      read(
        await handlePutCategoryRule(
          request('PUT', `/groups/${groupId}/months/${month}/category-shares/${categoryId}`, token(who), body),
          ...opts(options),
          groupId,
          month,
          categoryId,
        ),
      ),
  };
}
