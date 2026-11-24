// 月締め・精算のServiceの組み立て（`src/services/settlementService.ts`）。HTTPのRepositoryに、通知で包んだ `sessionAccess` を
// つなぐ。認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを画面へ伝えるのは、その包みだけ。
// CLAUDE.md）。APIの置き場は、各Repositoryの既定（`API_ORIGIN`。本番のドメインが決まるまで仮の値）のまま。
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createMonthRepository } from '../src/repositories/monthRepository.ts';
import { createSettlementRepository } from '../src/repositories/settlementRepository.ts';
import { createSettlementService, type SettlementService } from '../src/services/settlementService.ts';
import { sessionAccess } from './accountService.ts';

export const settlementService: SettlementService = createSettlementService({
  groups: createGroupRepository(fetch),
  months: createMonthRepository(fetch),
  settlements: createSettlementRepository(fetch),
  access: sessionAccess,
});
