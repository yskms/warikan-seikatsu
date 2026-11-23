// グループのHTTP（GET /groups・POST /groups）。Serviceからだけ使う。画面・Serviceは、URLやレスポンスの形を知らない。
// リクエスト・レスポンスの形は docs/backend-design.md 9章の「グループAPI」が正で、Worker（worker/）とはコードを共有しない。
//
// HTTPの共通の扱い（再試行しない・5xxの扱い・Cookieを送らない・タイムアウト）は `apiClient.ts`。失敗は、アカウントと同じ
// `AuthError`（`authError.ts`。名前は認証用だが、HTTPの失敗の分類は共通。401 は `unauthorized`、400・409 などは
// `invalid-request`、形の違う応答は `invalid-response`）。認証が要る呼び出しなので、セッションは Service が
// `sessionAccess.withSession` から受け取って渡す（画面・この層から、通知を直接呼ばない。CLAUDE.md）。
//
// 応答は、使う項目の型だけを確かめる。形の違う応答は `invalid-response`（画面が、壊れた値で動かないように）。
import {
  MEMBER_STATUSES,
  type Group,
  type GroupListItem,
  type GroupMember,
  type MemberStatus,
} from '../domain/group.ts';
import { createApiClient, isOpaqueValue, isRecord, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';

export type GroupFetchLike = ApiFetchLike;

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

function invalid(): never {
  throw new AuthError('invalid-response');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

function id(value: unknown): string {
  return isOpaqueValue(value) ? value : invalid();
}

function int(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid();
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

function nullableStr(value: unknown): string | null {
  return value === null ? null : str(value);
}

function memberStatus(value: unknown): MemberStatus {
  return MEMBER_STATUSES.find((status) => status === value) ?? invalid();
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) ? value : invalid();
}

function parseMember(value: unknown): GroupMember {
  const data = record(value);
  return {
    id: id(data.id),
    displayName: str(data.displayName),
    color: str(data.color),
    status: memberStatus(data.status),
    historyFromMonth: str(data.historyFromMonth),
    leaveRequestedMonth: nullableStr(data.leaveRequestedMonth),
    expenseEndMonth: nullableStr(data.expenseEndMonth),
    isMe: bool(data.isMe),
  };
}

export function parseGroup(value: unknown): Group {
  const data = record(value);
  if (!Array.isArray(data.members)) invalid();
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
    members: data.members.map(parseMember),
  };
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
    memberStatus: memberStatus(data.memberStatus),
    historyFromMonth: str(data.historyFromMonth),
    leaveRequestedMonth: nullableStr(data.leaveRequestedMonth),
    expenseEndMonth: nullableStr(data.expenseEndMonth),
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
        if (!Array.isArray(data.groups)) invalid();
        return data.groups.map(parseListItem);
      });
    },

    /**
     * `POST /groups`。グループと、自分のメンバー行、初期の費目を作る。201（新規）も、同じ `id` の再送の200
     * （保存済みのグループ）も、成功として `group` を返す。
     */
    create(session: string, request: CreateGroupRequest): Promise<Group> {
      return client.request('POST', '/groups', { session, json: request }, async (response) => {
        const data = record(await response.json());
        return parseGroup(data.group);
      });
    },
  };
}

export type GroupRepository = ReturnType<typeof createGroupRepository>;
