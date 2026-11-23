// グループのServiceの組み立て（`src/services/groupService.ts`）。HTTPのRepositoryに、通知で包んだ `sessionAccess` をつなぐ。
// 認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを画面へ伝えるのは、その包みだけ。
// CLAUDE.md）。APIの置き場は、`createGroupRepository` の既定（`API_ORIGIN`。本番のドメインが決まるまで仮の値）のまま。
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createGroupService, type GroupService } from '../src/services/groupService.ts';
import { sessionAccess } from './accountService.ts';

export const groupService: GroupService = createGroupService({
  groups: createGroupRepository(fetch),
  access: sessionAccess,
});
