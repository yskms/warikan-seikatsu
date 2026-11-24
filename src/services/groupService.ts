// グループ（所属の一覧・作成）。認証が要る呼び出しは、必ず `SessionAccess.withSession` を通す
// （端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
import type { GroupListItem } from '../domain/group.ts';
import type {
  CreatedGroup,
  CreateGroupRequest,
  GroupRepository,
  LeaveRequested,
} from '../repositories/groupRepository.ts';
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
    createGroup(request: CreateGroupRequest): Promise<CreatedGroup> {
      return access.withSession((session) => groups.create(session, request));
    },

    /**
     * 「今月で脱退する」を選ぶ。**やり直さない**（競合したら、画面が読み直して、もう一度押してもらう。確認の内容が変わりうる）。
     * 脱退月がすでに締められていれば、その場で確定する（`confirmed`）。最後の1人なら、グループが消える（`groupDeleted`）。
     * 確定した人は、所属の一覧から消えることがあるので、画面は、一覧を読み直す（`ui/groupList.ts` の `reloadGroups`）。
     */
    requestLeave(groupId: string): Promise<LeaveRequested> {
      return access.withSession((session) => groups.requestLeave(session, groupId));
    },

    /** 脱退を取り消す（確定するまで）。やり直さない。 */
    cancelLeave(groupId: string): Promise<void> {
      return access.withSession((session) => groups.cancelLeave(session, groupId));
    },
  };
}

export type GroupService = ReturnType<typeof createGroupService>;
