// 固定費の登録・編集シート（docs/screens.md 6章の「固定費」）の入力の状態・検査・リクエストの組み立て。画面（RN）には依存しない
// （`npm test` で守る）。支出のシート（`expenseForm.ts`）と同じ考え方で、負担の指定の入力は `splitForm.ts` を共有する。
//
// **負担額の計算は、ここでしない**（CLAUDE.md）。固定費は、金額・費目・支払う人・負担の指定を保存し、毎月の登録（Cron）が
// 支出を作るときに、サーバーが負担額を計算する。
//
// 支払う人・負担の対象に選べるメンバーは、「最初に支出を作る月」で見る（docs/backend-design.md 9章の「固定費API」。
// `worker/src/months.ts` の `recurringTargetMonth`）: 開始する月と今月の遅いほうが予定の月で、それが締められていれば、最も古い
// 未締めの月。アプリは月の一覧の `open` から決める（`firstTargetMonth`）。サーバーも検べる（使えなければ409 `member_not_available`）。
import { amountState, expressionFromAmount, type AmountState } from './amountExpression.ts';
import { shiftMonth } from './calendar.ts';
import { amountBlocker, codePointLength, isMemberSelectable, MAX_DESCRIPTION_LENGTH } from './expenseForm.ts';
import { formatMoney } from './money.ts';
import {
  blankSplitDraft,
  buildSplitRequest,
  checkSplitDraft,
  memberIdsOfSplit,
  sameSplit,
  splitDraftFromRequest,
  syncSplitDraft,
  withoutZeroRows,
  type SplitCheck,
  type SplitDraft,
} from './splitForm.ts';
import type { SplitRequest } from '../domain/expense.ts';
import type { GroupMember } from '../domain/group.ts';
import type { Category, MonthListItem } from '../domain/month.ts';
import type { NewRecurringRequest, RecurringExpense, UpdateRecurringRequest } from '../domain/recurring.ts';
import type { RecurringData } from './recurringService.ts';

/** 毎月の日を選ぶ範囲（1〜31。その月に無い日は月末日） */
export const DAYS_OF_MONTH: readonly number[] = Array.from({ length: 31 }, (_, index) => index + 1);

/** 開始する月を選べる範囲の先（今月から、何か月先まで） */
const START_MONTH_AHEAD = 24;
/** 終了する月を選べる範囲の先（開始する月から、何か月先まで） */
const END_MONTH_AHEAD = 120;

export interface RecurringDraft {
  /** 金額の式（`amountExpression.ts`） */
  amount: string;
  categoryId: string | null;
  payerMemberId: string | null;
  /** 毎月の日（1〜31）。新規は、選ぶまで `null` */
  dayOfMonth: number | null;
  description: string;
  /** `YYYY-MM` */
  startMonth: string;
  /** `YYYY-MM`。終了なしは `null` */
  endMonth: string | null;
  /** `null` は、カテゴリの割合で分ける */
  split: SplitDraft | null;
}

export interface RecurringFormContext {
  currencyCode: string;
  minorUnit: number;
  /** グループのタイムゾーンでのカレンダー上の今月（月の一覧の `currentMonth`） */
  currentMonth: string;
  months: readonly MonthListItem[];
  /** 脱退済み・削除済みも含む全員（名前を引くため） */
  members: readonly GroupMember[];
  /** カテゴリ（並び順どおり。アーカイブ済みも含む） */
  categories: readonly Category[];
  myMemberId: string;
  /** 編集で開いた固定費 */
  editing: RecurringExpense | null;
}

/** 読み込んだデータから、シートの文脈を作る。 */
export function buildRecurringContext(data: RecurringData, editing: RecurringExpense | null): RecurringFormContext {
  return {
    currencyCode: data.group.currencyCode,
    minorUnit: data.group.currencyMinorUnit,
    currentMonth: data.months.currentMonth,
    months: data.months.months,
    members: data.group.members,
    categories: data.categories,
    myMemberId: data.group.memberId,
    editing,
  };
}

// --- 月・メンバー・カテゴリ ---

/**
 * 最初に支出を作る月（支払う人・負担の対象が使えるかを見る月）。開始する月と今月の遅いほうが予定の月で、予定の月が締められて
 * いれば、それ以降で最も古い未締めの月。月の一覧に無い月（先の月）は、そのまま予定の月。
 */
export function firstTargetMonth(startMonth: string, ctx: Pick<RecurringFormContext, 'currentMonth' | 'months'>): string {
  const scheduled = startMonth > ctx.currentMonth ? startMonth : ctx.currentMonth;
  const open = ctx.months.find((item) => item.status === 'open' && item.month >= scheduled);
  return open?.month ?? scheduled;
}

/** 支払う人の選択肢。編集で開いた固定費の支払う人は、使えないメンバー（脱退した人）でも、いまの値として含める。 */
export function payerOptions(ctx: RecurringFormContext, month: string): GroupMember[] {
  const own = ctx.editing?.payerMemberId;
  return ctx.members.filter((member) => member.id === own || isMemberSelectable(member, month));
}

/** 負担の対象の選択肢。選べるメンバーと、編集で開いた固定費の負担に入っているメンバー。 */
export function splitMembers(ctx: RecurringFormContext, month: string): GroupMember[] {
  const inOriginal = new Set(memberIdsOfSplit(ctx.editing?.split ?? null));
  return ctx.members.filter((member) => inOriginal.has(member.id) || isMemberSelectable(member, month));
}

function splitMemberIds(ctx: RecurringFormContext, month: string): string[] {
  return splitMembers(ctx, month).map((member) => member.id);
}

/** カテゴリの選択肢。アーカイブしたカテゴリは選べない（編集で開いた固定費のカテゴリは、いまの値として含める）。 */
export function categoryOptions(ctx: RecurringFormContext): Category[] {
  const own = ctx.editing?.categoryId;
  return ctx.categories.filter((category) => !category.archived || category.id === own);
}

/** 編集で開いた固定費の負担の方法を、アプリが変えられない（知らない方法）か。変えられないときは、金額も変えられない。 */
export function splitLocked(ctx: RecurringFormContext): boolean {
  return ctx.editing !== null && ctx.editing.split === null;
}

// --- 月の選択（開始する月・終了する月） ---

export interface MonthRange {
  min: string;
  max: string;
}

/** 開始する月を選べる範囲。今月から先（過去の月は作らない）。編集では、保存されている月が過去でも、いまの値として含める。 */
export function startMonthRange(ctx: RecurringFormContext): MonthRange {
  const own = ctx.editing?.startMonth;
  const min = own !== undefined && own < ctx.currentMonth ? own : ctx.currentMonth;
  return { min, max: shiftMonth(ctx.currentMonth, START_MONTH_AHEAD) ?? ctx.currentMonth };
}

/** 終了する月を選べる範囲。開始する月から先。 */
export function endMonthRange(draft: RecurringDraft): MonthRange {
  return { min: draft.startMonth, max: shiftMonth(draft.startMonth, END_MONTH_AHEAD) ?? draft.startMonth };
}

/** 月を `delta` か月ずらす。範囲の外になるなら `null`。 */
export function stepMonth(month: string, delta: number, range: MonthRange): string | null {
  const next = shiftMonth(month, delta);
  return next !== null && next >= range.min && next <= range.max ? next : null;
}

// --- 入力の初期値と変更 ---

/**
 * シートを開いたときの入力。新規は、今月から・自分が支払う・先頭のカテゴリ。日は選んでもらう。**前回選んだカテゴリは使わない**
 * （`platform/lastCategory.ts` は、支出の登録の既定。家賃などの固定費のカテゴリを、日々の支出の既定にしない）。
 */
export function initialDraft(ctx: RecurringFormContext): RecurringDraft {
  const editing = ctx.editing;
  if (editing !== null) {
    const month = firstTargetMonth(editing.startMonth, ctx);
    return {
      amount: expressionFromAmount(editing.amountMinor, ctx.minorUnit),
      categoryId: editing.categoryId,
      payerMemberId: editing.payerMemberId,
      dayOfMonth: editing.dayOfMonth,
      description: editing.description ?? '',
      startMonth: editing.startMonth,
      endMonth: editing.endMonth,
      split: editing.split === null ? null : splitDraftFromRequest(editing.split, splitMemberIds(ctx, month), ctx.minorUnit),
    };
  }
  const category = categoryOptions(ctx)[0];
  const month = firstTargetMonth(ctx.currentMonth, ctx);
  const me = payerOptions(ctx, month).find((member) => member.id === ctx.myMemberId);
  return {
    amount: '',
    categoryId: category?.id ?? null,
    payerMemberId: me?.id ?? null,
    dayOfMonth: null,
    description: '',
    startMonth: ctx.currentMonth,
    endMonth: null,
    split: null,
  };
}

/** 「この固定費だけ負担を変える」のオン・オフ。オンにしたときは、全員で均等から始める。 */
export function toggleCustomSplit(draft: RecurringDraft, ctx: RecurringFormContext): RecurringDraft {
  if (draft.split !== null) return { ...draft, split: null };
  return { ...draft, split: blankSplitDraft(splitMemberIds(ctx, firstTargetMonth(draft.startMonth, ctx)), 'equal') };
}

/**
 * 開始する月を変える。終了する月が開始する月より前になるなら、開始する月に合わせる。負担の入力を、最初に支出を作る月に選べる
 * メンバーに合わせる（選べないメンバーを外し、選べるようになったメンバーを足す。入力済みの値は、残るメンバーでは保つ）。
 * 支払う人は、**ここでは外さない**: 選べないあいだは、保存の検査（`checkDraft`）が「支払う人を選び直してください」で止める。
 */
export function setStartMonth(draft: RecurringDraft, startMonth: string, ctx: RecurringFormContext): RecurringDraft {
  const next: RecurringDraft = {
    ...draft,
    startMonth,
    endMonth: draft.endMonth !== null && draft.endMonth < startMonth ? startMonth : draft.endMonth,
  };
  if (next.split === null) return next;
  return { ...next, split: syncSplitDraft(next.split, splitMemberIds(ctx, firstTargetMonth(startMonth, ctx))) };
}

/** 終了する月を決める・外す。決めるときは、開始する月と今月の遅いほうから1年先（終了の月を選ぶ初期値）。 */
export function toggleEndMonth(draft: RecurringDraft, ctx: RecurringFormContext): RecurringDraft {
  if (draft.endMonth !== null) return { ...draft, endMonth: null };
  const base = draft.startMonth > ctx.currentMonth ? draft.startMonth : ctx.currentMonth;
  return { ...draft, endMonth: shiftMonth(base, 11) ?? base };
}

// --- 検査 ---

export interface RecurringFormCheck {
  amount: AmountState;
  split: SplitCheck | null;
  /** 保存できない理由のうち、最初の1つ（無ければ `null`。金額が空のときは、案内を出さない） */
  blocker: string | null;
  canSave: boolean;
  /** 保存ボタンの文言（「登録 ¥80,000」「保存 ¥80,000」） */
  saveLabel: string;
}

/** 入力の検査。保存できるか、できないときの理由、保存ボタンの文言。 */
export function checkDraft(draft: RecurringDraft, ctx: RecurringFormContext): RecurringFormCheck {
  const amount = amountState(draft.amount, ctx.minorUnit);
  const month = firstTargetMonth(draft.startMonth, ctx);
  const split = draft.split === null ? null : checkSplitDraft(draft.split, splitMemberIds(ctx, month), amount, ctx);
  const verb = ctx.editing === null ? '登録' : '保存';
  const saveLabel = amount.kind === 'ok' ? `${verb} ${formatMoney(amount.minor, ctx.currencyCode, ctx.minorUnit)}` : verb;

  let blocker: string | null = amountBlocker(amount, ctx);
  if (blocker === null && amount.kind === 'ok' && splitLocked(ctx) && amount.minor !== ctx.editing?.amountMinor) {
    blocker = 'この固定費の負担の方法は、このアプリでは変えられないため、金額は変えられません。';
  }
  if (blocker === null && draft.categoryId === null) blocker = 'カテゴリを選んでください。';
  if (blocker === null && draft.payerMemberId === null) blocker = '支払う人を選んでください。';
  // 最初に支出を作る月に選べない支払う人（開始する月を変えたあと。その月に戻せば、また選べる）
  if (blocker === null && !payerOptions(ctx, month).some((member) => member.id === draft.payerMemberId)) {
    blocker = '支払う人を選び直してください。';
  }
  if (blocker === null && draft.dayOfMonth === null) blocker = '毎月の日を選んでください。';
  if (blocker === null && codePointLength(draft.description.trim()) > MAX_DESCRIPTION_LENGTH) {
    blocker = `内容は、${MAX_DESCRIPTION_LENGTH}文字までにしてください。`;
  }
  if (blocker === null && draft.endMonth !== null && draft.endMonth < draft.startMonth) {
    blocker = '終了する月は、開始する月以降にしてください。';
  }
  if (blocker === null && split !== null && !split.ok) blocker = split.message;

  const canSave = amount.kind === 'ok' && blocker === null;
  return { amount, split, blocker, canSave, saveLabel };
}

/**
 * 再開できない理由（無ければ `null`）。再開では、支払う人と負担の対象の**全員**が使えること、カテゴリを使うことが要る
 * （サーバーが409で断る。docs/backend-design.md 9章の「固定費API」）。アプリが負担の方法を扱えない固定費は、負担の指定を
 * 送り直せないので、再開できない。入力の検査（`checkDraft`）に通っていることが前提。
 */
export function resumeBlocker(draft: RecurringDraft, ctx: RecurringFormContext): string | null {
  const editing = ctx.editing;
  if (editing === null) return null;
  if (splitLocked(ctx)) {
    return 'この固定費の負担の方法は、このアプリでは扱えないため、再開できません。アプリを最新の版に更新してください。';
  }
  const month = firstTargetMonth(draft.startMonth, ctx);
  const usable = (memberId: string) => ctx.members.some((member) => member.id === memberId && isMemberSelectable(member, month));
  if (draft.payerMemberId === null || !usable(draft.payerMemberId)) return '支払う人が使えないため、再開できません。支払う人を選び直してください。';
  const category = ctx.categories.find((item) => item.id === draft.categoryId);
  if (category === undefined || category.archived) {
    return 'カテゴリが「使わない」設定のため、再開できません。別のカテゴリを選ぶか、カテゴリを「また使う」に戻してください。';
  }
  const split = buildSplitRequest(draft.split, splitMemberIds(ctx, month), ctx.minorUnit);
  if (split === null) return '負担の分け方を直してください。';
  if (memberIdsOfSplit(split).some((memberId) => !usable(memberId))) {
    return '負担の対象に、使えないメンバーがいます。負担の分け方を直してから、再開してください。';
  }
  return null;
}

// --- リクエストの組み立て ---

/** いまの入力の負担の指定（`category` か、負担を変える入力）。検査に通らなければ `null`。再開の確認に出す。 */
export function splitRequestOf(draft: RecurringDraft, ctx: RecurringFormContext): SplitRequest | null {
  const month = firstTargetMonth(draft.startMonth, ctx);
  return buildSplitRequest(draft.split, splitMemberIds(ctx, month), ctx.minorUnit);
}

/** 送る負担に入るメンバーのID（カテゴリの割合・検査に通らない入力は空）。保存が断られたとき、文言を決めるために使う。 */
export function splitMemberIdsOf(draft: RecurringDraft, ctx: RecurringFormContext): string[] {
  return memberIdsOfSplit(splitRequestOf(draft, ctx));
}

/**
 * 登録の本文（識別子を除く）。保存できないときは `null`。識別子は、登録の手順（`src/services/recurringCreate.ts`）が、シートごとに
 * 1回だけ作って付ける。
 */
export function buildCreateRequest(draft: RecurringDraft, ctx: RecurringFormContext): NewRecurringRequest | null {
  const check = checkDraft(draft, ctx);
  if (!check.canSave || check.amount.kind !== 'ok') return null;
  const month = firstTargetMonth(draft.startMonth, ctx);
  const split = buildSplitRequest(draft.split, splitMemberIds(ctx, month), ctx.minorUnit);
  if (split === null || draft.categoryId === null || draft.payerMemberId === null || draft.dayOfMonth === null) return null;
  const description = draft.description.trim();
  return {
    ...(description === '' ? {} : { description }),
    amountMinor: check.amount.minor,
    categoryId: draft.categoryId,
    payerMemberId: draft.payerMemberId,
    split,
    dayOfMonth: draft.dayOfMonth,
    startMonth: draft.startMonth,
    ...(draft.endMonth === null ? {} : { endMonth: draft.endMonth }),
    currencyCode: ctx.currencyCode,
  };
}

export type RecurringUpdatePlan =
  /** 保存できない（検査に通らない・再開できない） */
  | { kind: 'invalid' }
  /** 何も変えていない（サーバーへ送らず、閉じてよい） */
  | { kind: 'unchanged' }
  | { kind: 'request'; request: UpdateRecurringRequest };

/**
 * 編集のリクエスト。**変えたものだけ**を送る（サーバーは、送らなかった項目を変えない。内容や日だけの編集で、保存された負担の
 * 設定に触らない）。金額を変えるときは `currencyCode` を添える。負担の指定（`split`）は、変えたときと、金額指定（`fixed`）の
 * 固定費の金額を変えるとき（サーバーが400で求める。金額指定は自動で配分しない）に送る。割合・均等・1人は、金額に依らないので、
 * 金額だけ変えるときは送らない（送ると、使えなくなったメンバーが負担に残る固定費の金額が直せなくなる）。
 *
 * **0%・0円の行は、送らない**（支出と違い、もとの負担にいたメンバーの行も残さない）。サーバーは、負担の指定を送ると、その全員が
 * 使えるかを検べる（0%の行も対象）ので、使えなくなったメンバーの0の行が残ると、そのメンバーを0%にして直しても409で断られる。
 * 「変えていないか」の比較も、もとの負担の0の行を除いて行う（0の行だけが違うとき、変えたことにしない）。
 *
 * `resume` は、止まっている固定費を再開する（`paused: false` を添える）。`category` 以外の負担の固定費は、止めた理由によらず、
 * 負担の指定を送り直さないと再開できない（サーバーが400で求める。画面で確認した負担を、サーバーが勝手に有効にしない）ので、
 * 変えていなくても `split` を送る。アプリが負担の方法を扱えない固定費（`splitLocked`）は、`split` を送れないので、再開できない
 * （`resumeBlocker`）。
 */
export function buildUpdatePlan(
  draft: RecurringDraft,
  ctx: RecurringFormContext,
  options: { resume?: boolean } = {},
): RecurringUpdatePlan {
  const original = ctx.editing;
  const resume = options.resume === true;
  const check = checkDraft(draft, ctx);
  if (original === null || !check.canSave || check.amount.kind !== 'ok') return { kind: 'invalid' };
  if (draft.categoryId === null || draft.payerMemberId === null || draft.dayOfMonth === null) return { kind: 'invalid' };
  if (resume && resumeBlocker(draft, ctx) !== null) return { kind: 'invalid' };

  const request: UpdateRecurringRequest = {};
  const description = draft.description.trim();
  if (description !== (original.description ?? '')) request.description = description === '' ? null : description;
  const amountChanged = check.amount.minor !== original.amountMinor;
  if (amountChanged) {
    request.amountMinor = check.amount.minor;
    request.currencyCode = ctx.currencyCode;
  }
  if (draft.categoryId !== original.categoryId) request.categoryId = draft.categoryId;
  if (draft.payerMemberId !== original.payerMemberId) request.payerMemberId = draft.payerMemberId;
  if (draft.dayOfMonth !== original.dayOfMonth) request.dayOfMonth = draft.dayOfMonth;
  if (draft.startMonth !== original.startMonth) request.startMonth = draft.startMonth;
  if (draft.endMonth !== original.endMonth) request.endMonth = draft.endMonth;

  if (original.split !== null) {
    const month = firstTargetMonth(draft.startMonth, ctx);
    const split = buildSplitRequest(draft.split, splitMemberIds(ctx, month), ctx.minorUnit);
    if (split === null) return { kind: 'invalid' };
    const changed = !sameSplit(split, withoutZeroRows(original.split));
    const needsForAmount = amountChanged && original.split.method === 'fixed';
    const needsForResume = resume && split.method !== 'category';
    if (changed || needsForAmount || needsForResume) request.split = split;
  }

  if (resume) request.paused = false;
  return Object.keys(request).length === 0 ? { kind: 'unchanged' } : { kind: 'request', request };
}
