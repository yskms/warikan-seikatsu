// 支出のServiceの組み立て（`src/services/expenseService.ts`）。HTTPのRepositoryに、通知で包んだ `sessionAccess` をつなぐ。
// 認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを画面へ伝えるのは、その包みだけ。
// CLAUDE.md）。APIの置き場は、各Repositoryの既定（`API_ORIGIN`。本番のドメインが決まるまで仮の値）のまま。
import { createCategoryRepository } from '../src/repositories/categoryRepository.ts';
import { createExpenseRepository } from '../src/repositories/expenseRepository.ts';
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createMonthRepository } from '../src/repositories/monthRepository.ts';
import { createExpenseService, type ExpenseService } from '../src/services/expenseService.ts';
import { createExpenseNoticeStore } from '../src/services/expenseNotice.ts';
import { sessionAccess } from './accountService.ts';

export const expenseService: ExpenseService = createExpenseService({
  groups: createGroupRepository(fetch),
  months: createMonthRepository(fetch),
  expenses: createExpenseRepository(fetch),
  categories: createCategoryRepository(fetch),
  access: sessionAccess,
});

/** シート（モーダル）からホームへ、保存した月を渡す入れ物（`src/services/expenseNotice.ts`） */
export const expenseNotice = createExpenseNoticeStore();
