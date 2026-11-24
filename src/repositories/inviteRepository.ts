// 招待のHTTP（発行・自分が発行した未使用の招待の一覧・取り消しと、招待を開いて参加する側の、内容の確認・参加）。
// Serviceからだけ使う。形は docs/backend-design.md 9章の「招待・参加・脱退API」が正で、Worker（worker/）とはコードを共有しない。
//
// - 読み込み（`GET`）は、使う項目を全部検べる。
// - 書き込みの応答は、**使う項目だけ**を検べる（CLAUDE.md）。発行は `invite.id` と `invite.token` だけ（トークンは、この応答で
//   しか分からないので、読めなければ失敗にするしかない）。参加は `groupId` だけ。取り消しは204で本文が無く、本文は読まない。
// - 書き込みが断られたとき（403・404・409）は、`InviteRejectedError`（`AuthError` の `invalid-request`）に、サーバーが返した
//   理由を載せる。画面が「満員」「未使用の招待が上限」「すでに使われた」を出し分けるため（`src/services/inviteMessage.ts`）。
// - 発行は、同じ呼び出しを送り直すと、**新しい招待がもう1つできる**（冪等キーは無い）。結果が分からない失敗（通信が切れた・応答が
//   読めない）のあとは、招待が作られているかもしれない。一覧を読み直せば分かる（ただし、トークンはもう分からない）。取り消しは、
//   送り直しても同じ結果（すでに取り消し済みでも204）。
// - 参加（`join`）も冪等キーは無いが、送り直しは安全: すでに参加していれば、サーバーは使用済みの招待でも 409 `already_member`
//   （`groupId` つき）を返す（`InviteRejectedError.groupId`）。結果が分からない失敗のあとは、もう一度送れば、参加が済んでいたことが分かる。
import type { Invite, InvitePreview, IssuedInvite, JoinedInvite } from '../domain/invite.ts';
import { createApiClient, isOpaqueValue, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { array, bool, id, int, record, str } from './parse.ts';

export type InviteFetchLike = ApiFetchLike;

/**
 * 書き込みをサーバーが断った（403・404・409）。`code` は `invalid-request`。やり直しても同じ結果になる失敗で、理由
 * （`reason`。サーバーの `error`）によって、画面の案内を変える。理由の形が読めなければ `null`。
 */
export class InviteRejectedError extends AuthError {
  readonly status: number;
  /**
   * サーバーの `error`（`forbidden`・`not_found`・`invite_unavailable`・`group_full`・`already_member`・`too_many_invites`・
   * `invite_already_used`・`conflict` など）
   */
  readonly reason: string | null;
  /** 409 `already_member` が添える、参加中のグループのID。それ以外の断りでは、また読めなかったときは `null` */
  readonly groupId: string | null;

  constructor(status: number, reason: string | null, groupId: string | null = null) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'InviteRejectedError';
    this.status = status;
    this.reason = reason;
    this.groupId = groupId;
  }
}

/** 書き込みの断り（403・404・409）から、`InviteRejectedError` を作る。`ApiRequestInit.rejected` に渡す。 */
async function inviteRejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  // 本文が読めなくても（JSONでない403など）、サーバーが断ったことは確か。理由だけ `null` にして、`InviteRejectedError` を返す
  // （投げると、`apiClient.ts` は、ただの `invalid-request` にする。画面が、「済んでいない」と「分からない」を見分けられない）
  let reason: string | null = null;
  let groupId: string | null = null;
  try {
    const data = record(await response.json());
    if (typeof data.error === 'string' && data.error.length <= 64) reason = data.error;
    if (isOpaqueValue(data.groupId)) groupId = data.groupId;
  } catch {
    // reason・groupId は null のまま
  }
  return new InviteRejectedError(status, reason, groupId);
}

// トークンは、そのままURLの道（`/invite/<token>`）に入れる。URLに載せて壊れない文字（base64url）だけを受ける
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function parseInvite(value: unknown): Invite {
  const data = record(value);
  return { id: id(data.id), expiresAt: int(data.expiresAt), createdAt: int(data.createdAt) };
}

export function createInviteRepository(
  fetchImpl: InviteFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /**
     * `POST /groups/:id/invites`。招待を1つ発行する。発行から3日で切れる、使い捨て。使うのは `invite.id` と `invite.token`
     * だけ。断られたら `InviteRejectedError`。
     */
    create(session: string, groupId: string): Promise<IssuedInvite> {
      return client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/invites`,
        { session, rejected: inviteRejection },
        async (response) => {
          const invite = record(record(await response.json()).invite);
          const token = invite.token;
          if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new AuthError('invalid-response');
          return { id: id(invite.id), token };
        },
      );
    },

    /** `GET /groups/:id/invites`。自分が発行した、未使用で期限内の招待（トークンは返らない）。 */
    list(session: string, groupId: string): Promise<Invite[]> {
      return client.request('GET', `/groups/${encodeURIComponent(groupId)}/invites`, { session }, async (response) => {
        const data = record(await response.json());
        return array(data.invites).map(parseInvite);
      });
    },

    /**
     * `DELETE /invites/:id`。招待を取り消す（発行した人だけ）。すでに取り消し済みでも成功（204）。使われた招待は
     * 409 `invite_already_used`。断られたら `InviteRejectedError`。
     */
    revoke(session: string, inviteId: string): Promise<void> {
      return client.request(
        'DELETE',
        `/invites/${encodeURIComponent(inviteId)}`,
        { session, rejected: inviteRejection },
        async () => undefined,
      );
    },

    /**
     * `GET /invites/:token`。招待の内容を確認する（要ログイン。開いただけでは何も変わらない）。読み込みなので、全項目を検べる。
     * 使えない招待（知らないトークン・期限切れ・使用済み・取り消し済み・発行者が抜けた）は、理由を区別せず404
     * `invite_unavailable`（`InviteRejectedError`）。すでにそのグループに参加中なら、招待の状態によらず `alreadyMember: true`。
     * 満員でも招待は有効（`groupFull: true`。404にはならない）。
     */
    preview(session: string, token: string): Promise<InvitePreview> {
      return client.request(
        'GET',
        `/invites/${encodeURIComponent(token)}`,
        { session, rejected: inviteRejection },
        async (response) => {
          const data = record(await response.json());
          if (bool(data.alreadyMember)) return { alreadyMember: true, groupId: id(data.groupId) };
          return {
            alreadyMember: false,
            groupName: str(data.groupName),
            invitedByDisplayName: str(data.invitedByDisplayName),
            groupFull: bool(data.groupFull),
          };
        },
      );
    },

    /**
     * `POST /invites/:token/join`。明示的な参加。`displayName` は、このグループの中での名前（前後の空白を落として、1〜20文字）。
     * 応答は、`groupId` だけを読む。断られたら `InviteRejectedError`: 404 `invite_unavailable`（使えない招待）、409 `group_full`
     * （満員）、409 `already_member`（すでに参加中。`groupId` つき）、409 `conflict`（同時に参加しようとした人と競合）。
     * 結果が分からない失敗のあとは、**同じ呼び出しを送り直してよい**（上の説明）。
     */
    join(session: string, token: string, displayName: string): Promise<JoinedInvite> {
      return client.request(
        'POST',
        `/invites/${encodeURIComponent(token)}/join`,
        { session, json: { displayName }, rejected: inviteRejection },
        async (response) => ({ groupId: id(record(await response.json()).groupId) }),
      );
    },
  };
}

export type InviteRepository = ReturnType<typeof createInviteRepository>;
