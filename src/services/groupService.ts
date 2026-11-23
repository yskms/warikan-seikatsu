// グループ（所属の一覧・作成）。認証が要る呼び出しは、必ず `SessionAccess.withSession` を通す
// （端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
import type { Group, GroupListItem } from '../domain/group.ts';
import type { CreateGroupRequest, GroupRepository } from '../repositories/groupRepository.ts';
import type { SessionAccess } from './accountService.ts';

export interface GroupServiceDeps {
  groups: GroupRepository;
  access: SessionAccess;
}

export function createGroupService({ groups, access }: GroupServiceDeps) {
  return {
    /** 所属グループ（作成の古い順）。 */
    listGroups(): Promise<GroupListItem[]> {
      return access.withSession((session) => groups.list(session));
    },

    /**
     * グループを作る。`request.id` は、この作成の識別子（呼び出し側が、フォームを開いたときに1回だけ作る）。
     * 通信が切れて結果が分からないときは、**同じ `id` で**もう一度呼ぶ（グループが2つにならない）。
     */
    createGroup(request: CreateGroupRequest): Promise<Group> {
      return access.withSession((session) => groups.create(session, request));
    },
  };
}

export type GroupService = ReturnType<typeof createGroupService>;
