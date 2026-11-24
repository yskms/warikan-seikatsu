// 招待・参加・脱退のAPIのテストで使う、呼び出しの道具（monthApi.ts と同じ作り）。
import { handleCreateInvite, handleGetInvite, handleJoin, handleListInvites, handleRevokeInvite } from '../src/invites.ts';
import { handleCancelLeave, handleRequestLeave } from '../src/leave.ts';
import { NOW, type Person } from './apiFixture.ts';
import { read, request, type ApiResult } from './monthApi.ts';

interface Options {
  now?: number;
  env?: Env;
  /** グループが消えることを確認した、という申告（クエリ `acknowledgeDelete=true`。`src/deleteAck.ts`） */
  acknowledgeDelete?: boolean;
}

/** 各APIの呼び出し。`who` が null なら、セッション無し。 */
export function membershipApi(defaultEnv: Env) {
  const opts = (options: Options) => [options.env ?? defaultEnv, options.now ?? NOW] as const;
  return {
    createInvite: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleCreateInvite(request('POST', `/groups/${groupId}/invites`, who?.token ?? null), ...opts(options), groupId)),
    listInvites: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleListInvites(request('GET', `/groups/${groupId}/invites`, who?.token ?? null), ...opts(options), groupId)),
    revokeInvite: async (who: Person | null, inviteId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleRevokeInvite(request('DELETE', `/invites/${inviteId}`, who?.token ?? null), ...opts(options), inviteId)),
    getInvite: async (who: Person | null, token: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleGetInvite(request('GET', `/invites/${token}`, who?.token ?? null), ...opts(options), token)),
    join: async (
      who: Person | null,
      token: string,
      body: unknown = { displayName: 'newcomer' },
      options: Options = {},
    ): Promise<ApiResult> =>
      read(await handleJoin(request('POST', `/invites/${token}/join`, who?.token ?? null, body), ...opts(options), token)),
    requestLeave: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleRequestLeave(request('POST', `/groups/${groupId}/leave${options.acknowledgeDelete ? '?acknowledgeDelete=true' : ''}`, who?.token ?? null), ...opts(options), groupId)),
    cancelLeave: async (who: Person | null, groupId: string, options: Options = {}): Promise<ApiResult> =>
      read(await handleCancelLeave(request('DELETE', `/groups/${groupId}/leave`, who?.token ?? null), ...opts(options), groupId)),
  };
}
