// メンバーと招待のServiceの組み立て（`src/services/inviteService.ts`）。HTTPのRepositoryに、通知で包んだ `sessionAccess` をつなぐ。
// 認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを画面へ伝えるのは、その包みだけ。
// CLAUDE.md）。APIの置き場は、各Repositoryの既定（`API_ORIGIN`。本番のドメインが決まるまで仮の値）のまま。
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createInviteRepository } from '../src/repositories/inviteRepository.ts';
import { createInviteService, type InviteService } from '../src/services/inviteService.ts';
import { sessionAccess } from './accountService.ts';

export const inviteService: InviteService = createInviteService({
  groups: createGroupRepository(fetch),
  invites: createInviteRepository(fetch),
  access: sessionAccess,
});
