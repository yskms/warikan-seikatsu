// 固定費の登録の手順（`ui/settings/RecurringEditSheet.tsx` が使う。画面（RN）に依存しないので、`npm test` で守る）。
// カテゴリの追加の手順（`categoryCreate.ts`）と同じ形。
//
// - 登録の `id` は、最初に送るときに1回だけ作り、やり直しでも使い回す（結果が分からない失敗のあとで、同じ固定費が2件に
//   ならない。固定費が2件になると、毎月2件ずつ支出が作られる）。
// - サーバーは、同じ `id` の再送に、保存済みの固定費をそのまま返す（内容は見比べない）。結果が分からない失敗のあとに入力を直して
//   送り直すと、直した内容が反映されないまま、成功として返る（その金額のまま、毎月、自動で支出が作られ続ける）。そのため、その
//   送り直しのあとに、いまの入力を `PATCH` で送る（全項目。送ったものと保存されたものが同じでも、害は無い）。
// - **登録が済んだあとは、登録を送らない**（`createdId`）。そのあとの `PATCH` の失敗は、登録の失敗と別の段階（`create-update`）として
//   返し、`id` を取り直さない。登録は済んでいるので、新しい `id` にすると、同じ固定費が2件できる。やり直しでは、`PATCH` だけを送る。
// - 登録の呼び出しの 409 `conflict` は、**理由が2つあり、どちらも登録されていない**: この `id` を他のグループが使っている、
//   書き込みの競合が続いた（Workerの `failureResponse`。書き込み全体が取り消されている）。前者は、同じ `id` で送り直しても同じ
//   失敗になるので、新しい `id` にする（後者でも、登録されていないので、新しい `id` にして安全）。**登録が済んだあとの `PATCH` の
//   409 には使わない**（登録は済んでいるので、新しい `id` にすると、同じ固定費が2件できる。`create-update`）。
import type { NewRecurringRequest, RecurringSaved, UpdateRecurringRequest } from '../domain/recurring.ts';
import { RecurringRejectedError } from '../repositories/recurringRepository.ts';

export interface RecurringCreatorDeps {
  create(groupId: string, request: NewRecurringRequest & { id: string }): Promise<RecurringSaved>;
  update(recurringId: string, request: UpdateRecurringRequest): Promise<RecurringSaved>;
  /** 登録の識別子（小文字のUUID）を作る */
  newId(): string;
}

/** どの段階で失敗したか（`create`: 登録の呼び出し。`create-update`: 登録が済んだあとの、入力の反映）と、元の失敗 */
export class RecurringCreateFailure extends Error {
  readonly step: 'create' | 'create-update';
  readonly error: unknown;

  constructor(step: 'create' | 'create-update', error: unknown) {
    super(`recurring ${step} failed`);
    this.name = 'RecurringCreateFailure';
    this.step = step;
    this.error = error;
  }
}

/** 登録の本文と同じ内容を、変更の本文にする（`description`・`endMonth` が無いときは、消す） */
function updateOf(body: NewRecurringRequest): UpdateRecurringRequest {
  return {
    description: body.description ?? null,
    amountMinor: body.amountMinor,
    categoryId: body.categoryId,
    payerMemberId: body.payerMemberId,
    split: body.split,
    dayOfMonth: body.dayOfMonth,
    startMonth: body.startMonth,
    endMonth: body.endMonth ?? null,
    currencyCode: body.currencyCode,
  };
}

/** 登録の409 `conflict`。他のグループが同じ `id` を使っている場合も、書き込みの競合の場合も、登録されていない（上のコメント） */
function isCreateConflict(error: unknown): boolean {
  return error instanceof RecurringRejectedError && error.reason === 'conflict';
}

/** 送ったあと、サーバーで済んだか分からない失敗か（サーバーが断った場合は、済んでいない） */
function resultUnknown(error: unknown): boolean {
  return !(error instanceof RecurringRejectedError);
}

export function createRecurringCreator({ create, update, newId }: RecurringCreatorDeps) {
  let requestId: string | null = null;
  // 結果が分からない失敗があったか（サーバーに登録されているかもしれない）
  let uncertain = false;
  // 登録が済んだ固定費のID
  let createdId: string | null = null;

  return {
    /** 登録が済んだか（以降、画面を閉じても、固定費は残る。入力の反映だけが済んでいないことがある） */
    created(): boolean {
      return createdId !== null;
    },

    /**
     * 登録を送る。`body` は、そのときの入力。やり直しのたびに、いまの入力で呼ぶ。失敗は `RecurringCreateFailure`
     * （どの段階かを持つ）。成功は、サーバーが返した結果（今月の分が作られないか、を含む）。
     */
    async submit(groupId: string, body: NewRecurringRequest): Promise<RecurringSaved> {
      let saved: RecurringSaved | null = null;
      if (createdId === null) {
        requestId ??= newId();
        // 前の送信の結果が分からなかったか（送り直しのあとは、いまの入力を `PATCH` で送る）
        const retry = uncertain;
        try {
          saved = await create(groupId, { id: requestId, ...body });
          createdId = saved.id;
        } catch (error) {
          if (isCreateConflict(error)) {
            // 登録されていない（理由は、どちらでも）。次は、新しい `id` にする
            requestId = null;
            uncertain = false;
          } else if (resultUnknown(error)) {
            uncertain = true;
          }
          throw new RecurringCreateFailure('create', error);
        }
        if (!retry) return saved;
      }
      try {
        return await update(createdId, updateOf(body));
      } catch (error) {
        throw new RecurringCreateFailure('create-update', error);
      }
    },
  };
}

export type RecurringCreator = ReturnType<typeof createRecurringCreator>;
