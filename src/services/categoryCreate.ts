// カテゴリの追加の手順（`ui/settings/CategoryEditSheet.tsx` が使う。画面（RN）に依存しないので、`npm test` で守る）。
//
// - 作成の `id` は、最初に送るときに1回だけ作り、やり直しでも使い回す（結果が分からない失敗のあとで、同じカテゴリが2つにならない）。
// - サーバーは、同じ `id` の再送に、保存済みの費目をそのまま返す（内容は見比べない）。結果が分からない失敗のあとに入力を直して
//   送り直すと、直した内容が反映されない。そのため、その送り直しのあとに、いまの入力を `PATCH` で送る。
// - **作成が済んだあとは、作成を送らない**（`createdId`）。そのあとの `PATCH` の失敗（409 `conflict` を含む）は、作成の失敗と別の段階
//   （`create-update`）として返し、`id` を取り直さない。作成は済んでいるので、新しい `id` にすると、同じカテゴリが2つできる。
//   やり直しでは、`PATCH` だけを送る。
// - 作成の呼び出しの 409 `conflict`（`isCreateConflict`）は、作られていない。新しい `id` にする。
import type { CreateCategoryInput, UpdateCategoryInput } from '../repositories/categoryRepository.ts';
import { isCreateConflict, resultUnknown } from './categoryMessage.ts';

export interface CategoryAdderDeps {
  createCategory(groupId: string, input: CreateCategoryInput): Promise<{ id: string }>;
  updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<{ id: string }>;
  /** 作成の識別子（小文字のUUID）を作る */
  newId(): string;
}

export type CategoryDraftBody = { name: string; icon: string; color: string };

/** 失敗は、どの段階か（`create`: 作成の呼び出し。`create-update`: 作成が済んだあとの入力の反映）と、元の失敗を返す */
export type AddResult = { ok: true } | { ok: false; step: 'create' | 'create-update'; error: unknown };

export function createCategoryAdder({ createCategory, updateCategory, newId }: CategoryAdderDeps) {
  let requestId: string | null = null;
  // 結果が分からない失敗があったか（サーバーに作られているかもしれない）
  let uncertain = false;
  // 作成が済んだ費目のID
  let createdId: string | null = null;

  return {
    /** 追加を送る。`body` は、そのときの入力。やり直しのたびに、いまの入力で呼ぶ。 */
    async submit(groupId: string, body: CategoryDraftBody): Promise<AddResult> {
      if (createdId === null) {
        requestId ??= newId();
        // 前の送信の結果が分からなかったか（送り直しのあとは、いまの入力を `PATCH` で確かめる）
        const retry = uncertain;
        try {
          createdId = (await createCategory(groupId, { id: requestId, ...body })).id;
        } catch (error) {
          if (isCreateConflict(error)) {
            // 作られていない。次は、新しい `id` にする
            requestId = null;
            uncertain = false;
          } else if (resultUnknown(error)) {
            uncertain = true;
          }
          return { ok: false, step: 'create', error };
        }
        if (!retry) return { ok: true };
      }
      try {
        await updateCategory(createdId, body);
      } catch (error) {
        return { ok: false, step: 'create-update', error };
      }
      return { ok: true };
    },
  };
}

export type CategoryAdder = ReturnType<typeof createCategoryAdder>;
