// グループのHTTP（GET /groups・GET /groups/:id・POST /groups・脱退を選ぶ POST /groups/:id/leave と取り消す DELETE）。Serviceからだけ使う。画面・Serviceは、URLやレスポンスの形を知らない。
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
import { createApiClient, isOpaqueValue, type ApiFetchLike } from './apiClient.ts';
import { AuthError } from './authError.ts';
import { array, bool, id, int, invalid, nullableStr, oneOfOrUnknown, record, str } from './parse.ts';

export type GroupFetchLike = ApiFetchLike;

/**
 * 作成の結果。**`id` だけを検べる**: 書き込みの応答は、形が少しずれただけで失敗にすると、サーバーでは作成が済んでいるのに
 * 画面が失敗と受け取る（同じ `id` で再送しても、同じ応答が返って、同じ失敗になる）。読み込み（`list`）は、形が合わなければ
 * 失敗にする（何も変わらない）。グループの詳細（`get`。メンバーなど）も読み込みなので、同じ。
 */
export interface CreatedGroup {
  id: string;
}

/**
 * 脱退を選ぶ・取り消す書き込みを、サーバーが断った（403・404・409）。`code` は `invalid-request`。やり直しても同じ結果になる失敗で、
 * 理由（`reason`。サーバーの `error`）によって、画面の案内を変える。理由の形が読めなければ `null`。
 */
export class GroupRejectedError extends AuthError {
  readonly status: number;
  /** サーバーの `error`（`not_found`・`leave_already_requested`・`leave_confirmed`・`not_leaving`・`conflict` など） */
  readonly reason: string | null;

  constructor(status: number, reason: string | null) {
    super('invalid-request', `HTTP ${status}`);
    this.name = 'GroupRejectedError';
    this.status = status;
    this.reason = reason;
  }
}

/** 書き込みの断り（403・404・409）から、`GroupRejectedError` を作る。`ApiRequestInit.rejected` に渡す。 */
async function groupRejection(status: number, response: { json(): Promise<unknown> }): Promise<Error> {
  // 本文が読めなくても、サーバーが断ったことは確か。理由だけ `null` にして返す（投げると、`apiClient.ts` が、ただの
  // `invalid-request` にし、画面が「済んでいない」と「分からない」を見分けられなくなる。`InviteRejectedError` と同じ）
  let reason: string | null = null;
  try {
    const data = record(await response.json());
    if (isOpaqueValue(data.error) && data.error.length <= 64) reason = data.error;
  } catch {
    // reason は null のまま
  }
  return new GroupRejectedError(status, reason);
}

/**
 * 脱退を選んだ結果。**使う項目だけ**を読む（書き込みの応答。形が少しずれただけで失敗にすると、サーバーでは済んでいるのに、画面が
 * 失敗と受け取る）。どちらも、無ければ `false`。
 */
export interface LeaveRequested {
  /** その場で脱退が確定した（脱退月がすでに締められていた）。確定すると、所属の一覧から消えることがある */
  confirmed: boolean;
  /** 最後の1人の脱退が確定して、グループのデータがすべて消えた */
  groupDeleted: boolean;
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
    leaveEffective: bool(data.leaveEffective),
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
    // 脱退を選ぶ操作の確認の警告に使う。読めなければ、警告が出ないまま選ばせてしまうので、失敗にする（読み込み）
    leaveDeletesGroup: bool(data.leaveDeletesGroup),
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
     * `POST /groups/:id/leave`。「今月で脱退する」。確定するまでは取り消せる。脱退月がすでに締められていれば、その場で確定する
     * （`confirmed`）。最後の1人の確定は、グループを消す（`groupDeleted`）。応答は、この2つだけを読む（`LeaveRequested`）。
     * 断られたら `GroupRejectedError`: 409 `leave_already_requested`（すでに選んでいる）・409 `leave_confirmed`（すでに確定した）・
     * 409 `conflict`（他の書き込みと競合した。やり直さない）・404 `not_found`・409 `delete_not_acknowledged`（グループが消えることに
     * なったのに、確認の申告が無かった。何も消えていない）。
     * `acknowledgeDelete`: 「グループのデータがすべて消えます」の警告を見せて、確認を得たか（クエリ `acknowledgeDelete=true`）。
     * 警告を出したときだけ true にする。確認を出したあとで状態が変わり（残る人が脱退済みになった、など）、警告の無い確認のまま、
     * グループが消えることになったときは、サーバーが何も消さずに断る（`worker/src/deleteAck.ts`）。付けても、消えない操作には効かない。
     */
    requestLeave(session: string, groupId: string, acknowledgeDelete = false): Promise<LeaveRequested> {
      return client.request(
        'POST',
        `/groups/${encodeURIComponent(groupId)}/leave${acknowledgeDelete ? '?acknowledgeDelete=true' : ''}`,
        { session, rejected: groupRejection },
        async (response) => {
          const data = record(await response.json());
          return { confirmed: data.confirmed === true, groupDeleted: data.groupDeleted === true };
        },
      );
    },

    /**
     * `DELETE /groups/:id/leave`。脱退を取り消す（確定するまで。脱退月が終わったあとは、Cronの確定の前でも取り消せない）。応答は
     * JSONのオブジェクトで、`leaveRequestedMonth` の項目があることだけを確かめる（値は読まない）: 何も読まないと、JSONでない200
     * （宿のWi-Fiの認証画面など）を、取り消せたと取り違える。断られたら `GroupRejectedError`: 409 `leave_confirmed`・
     * 409 `not_leaving`（選んでいない）・409 `conflict`・404。
     */
    cancelLeave(session: string, groupId: string): Promise<void> {
      return client.request(
        'DELETE',
        `/groups/${encodeURIComponent(groupId)}/leave`,
        { session, rejected: groupRejection },
        async (response) => {
          if (!('leaveRequestedMonth' in record(await response.json()))) invalid();
        },
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
