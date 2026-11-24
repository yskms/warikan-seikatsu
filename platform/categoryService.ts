// カテゴリと負担割合のServiceの組み立て（`src/services/categoryService.ts`）。HTTPのRepositoryに、通知で包んだ
// `sessionAccess` をつなぐ。認証が要る呼び出しは、必ず `sessionAccess.withSession` を通す（セッションが無くなったことを
// 画面へ伝えるのは、その包みだけ。CLAUDE.md）。APIの置き場は、各Repositoryの既定（`API_ORIGIN`。本番のドメインが決まる
// まで仮の値）のまま。
import { createCategoryRepository } from '../src/repositories/categoryRepository.ts';
import { createCategorySharesRepository } from '../src/repositories/categorySharesRepository.ts';
import { createGroupRepository } from '../src/repositories/groupRepository.ts';
import { createMonthRepository } from '../src/repositories/monthRepository.ts';
import { createCategoryService, type CategoryService } from '../src/services/categoryService.ts';
import { sessionAccess } from './accountService.ts';

export const categoryService: CategoryService = createCategoryService({
  groups: createGroupRepository(fetch),
  months: createMonthRepository(fetch),
  categories: createCategoryRepository(fetch),
  shares: createCategorySharesRepository(fetch),
  access: sessionAccess,
});
