// ホームのServiceの組み立て（`src/services/homeService.ts`）。HTTPのRepositoryに、通知で包んだ `sessionAccess` をつなぐ。
// 認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを画面へ伝えるのは、その包みだけ。
// CLAUDE.md）。APIの置き場は、各Repositoryの既定（`API_ORIGIN`。本番のドメインが決まるまで仮の値）のまま。
import { createCategoryRepository } from '../src/repositories/categoryRepository.ts';
import { createCategorySharesRepository } from '../src/repositories/categorySharesRepository.ts';
import { createExpenseRepository } from '../src/repositories/expenseRepository.ts';
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createMonthRepository } from '../src/repositories/monthRepository.ts';
import { createRecurringRepository } from '../src/repositories/recurringRepository.ts';
import { createHomeService, type HomeService } from '../src/services/homeService.ts';
import { sessionAccess } from './accountService.ts';

export const homeService: HomeService = createHomeService({
  groups: createGroupRepository(fetch),
  months: createMonthRepository(fetch),
  expenses: createExpenseRepository(fetch),
  categories: createCategoryRepository(fetch),
  categoryShares: createCategorySharesRepository(fetch),
  recurring: createRecurringRepository(fetch),
  access: sessionAccess,
});
