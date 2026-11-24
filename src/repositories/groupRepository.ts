// グループのHTTP（GET /groups・GET /groups/:id・POST /groups）。Serviceからだけ使う。画面・Serviceは、URLやレスポンスの形を知らない。
// リクエスト・レスポンスの形は docs/backend-design.md 9章の「グループAPI」が正で、Worker（worker/）とはコードを共有しない。
//
// HTTPの共通の扱い（再試行しない・5xxの扱い・Cookieを送らない・タイムアウト）は `apiClient.ts`。失敗は、アカウントと同じ
// `AuthError`（`authError.ts`。名前は認証用だが、HTTPの失敗の分類は共通。401 は `unauthorized`、400・409 などは
// `invalid-request`、形の違う応答は `invalid-response`）。認証が要る呼び出しなので、セッションは Service が
// `sessionAccess.withSession` から受け取って渡す（画面・この層から、通知を直接呼ばない。CLAUDE.md）。
//
// 応答は、使う項目の型だけを確かめる（`parse.ts`）。形の違う応答は `invalid-response`（画面が、壊れた値で動かないように）。
import {
  MEMBER_STATUSES,
  type GroupDetail,
  type GroupListItem,
  type GroupMember,
} from '../domain/group.ts';
import { createApiClient, type ApiFetchLike } from './apiClient.ts';
import { array, bool, id, int, nullableStr, oneOfOrUnknown, record, str } from './parse.ts';

export type GroupFetchLike = ApiFetchLike;

/**
 * 作成の結果。**`id` だけを検べる**: 書き込みの応答は、形が少しずれただけで失敗にすると、サーバーでは作成が済んでいるのに
 * 画面が失敗と受け取る（同じ `id` で再送しても、同じ応答が返って、同じ失敗になる）。読み込み（`list`）は、形が合わなければ
 * 失敗にする（何も変わらない）。グループの詳細（`get`。メンバーなど）も読み込みなので、同じ。
 */
export interface CreatedGroup {
  id: string;
}

export interface CreateGroupRequest {
  /**
   * この作成の識別子（UUID。小文字）。同じ作成の再送で、グループが2つにならないための冪等キー。通信が切れて結果が
   * 分からないとき、画面は**同じ値で**やり直す（フォームを開いたときに1回だけ作る）。
   */
  id: string;
  name: string;
  displayName: string;
  currencyCode: string;
  /** 端末のIANAのタイムゾーン名（`Asia/Tokyo` など）。月の境目を決める */
  timezone: string;
}

function parseListItem(value: unknown): GroupListItem {
  const data = record(value);
  return {
    id: id(data.id),
    name: str(data.name),
    currencyCode: str(data.currencyCode),
    currencyMinorUnit: int(data.currencyMinorUnit),
    timezone: str(data.timezone),
    createdAt: int(data.createdAt),
    memberId: id(data.memberId),
    // 判断に使っていないので、知らない状態は失敗にしない（入口の一覧が、全部読めなくなるのを避ける。CLAUDE.md）
    memberStatus: oneOfOrUnknown(MEMBER_STATUSES, data.memberStatus),
    historyFromMonth: str(data.historyFromMonth),
    leaveRequestedMonth: nullableStr(data.leaveRequestedMonth),
    expenseEndMonth: nullableStr(data.expenseEndMonth),
  };
}

function parseMember(value: unknown): GroupMember {
  const data = record(value);
  return {
    id: id(data.id),
    displayName: str(data.displayName),
    color: str(data.color),
    status: oneOfOrUnknown(MEMBER_STATUSES, data.status),
    historyFromMonth: str(data.historyFromMonth),
    leaveRequestedMonth: nullableStr(data.leaveRequestedMonth),
    expenseEndMonth: nullableStr(data.expenseEndMonth),
    isMe: bool(data.isMe),
  };
}

function parseDetail(value: unknown): GroupDetail {
  const data = record(value);
  return {
    id: id(data.id),
    name: str(data.name),
    currencyCode: str(data.currencyCode),
    currencyMinorUnit: int(data.currencyMinorUnit),
    timezone: str(data.timezone),
    createdAt: int(data.createdAt),
    memberId: id(data.memberId),
    currencyLocked: bool(data.currencyLocked),
    seatedMembers: int(data.seatedMembers),
    maxMembers: int(data.maxMembers),
    canInvite: bool(data.canInvite),
    members: array(data.members).map(parseMember),
  };
}

export function createGroupRepository(
  fetchImpl: GroupFetchLike,
  options: { origin?: string; timeoutMs?: number } = {},
) {
  const client = createApiClient(fetchImpl, options);

  return {
    /** `GET /groups`。所属グループ（作成の古い順。データを扱える `active`・`leaving` だけ）。 */
    list(session: string): Promise<GroupListItem[]> {
      return client.request('GET', '/groups', { session }, async (response) => {
        const data = record(await response.json());
        return array(data.groups).map(parseListItem);
      });
    },

    /**
     * `GET /groups/:id`。グループの情報とメンバー（脱退済み・削除済みも含む全員。名前は残る）。読み込みなので、
     * 全項目を検べる。
     */
    get(session: string, groupId: string): Promise<GroupDetail> {
      return client.request('GET', `/groups/${encodeURIComponent(groupId)}`, { session }, async (response) =>
        parseDetail(record(await response.json()).group),
      );
    },

    /**
     * `POST /groups`。グループと、自分のメンバー行、初期の費目を作る。201（新規）も、同じ `id` の再送の200
     * （保存済みのグループ）も、成功。応答の `group` は、`id` だけを読む（`CreatedGroup`）。
     */
    create(session: string, request: CreateGroupRequest): Promise<CreatedGroup> {
      return client.request('POST', '/groups', { session, json: request }, async (response) => {
        const data = record(await response.json());
        return { id: id(record(data.group).id) };
      });
    },
  };
}

export type GroupRepository = ReturnType<typeof createGroupRepository>;
