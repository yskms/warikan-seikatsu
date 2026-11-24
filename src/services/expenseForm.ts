// 支出の登録・編集シート（docs/screens.md 4章）の入力の状態・検査・リクエストの組み立て。画面（RN）には依存しない
// （`npm test` で守る）。
//
// **負担額の計算は、ここでしない**（CLAUDE.md。負担・精算の計算はWorkerだけが持つ）。「この支出だけ負担を変える」で、
// 割合・均等の端数をどう配るかを、アプリに書き写さない（そのため、割合・均等では、メンバーごとの負担額のプレビューは出さない。
// 金額指定は、入力した金額そのものが負担額）。ここでするのは、入力の形の検査（合計が100%・金額の合計が一致、など）と、
// リクエストの組み立てだけ。サーバーが、登録できる月・メンバーの使えるか・合計の一致を、もう一度検べる（docs/backend-design.md 9章）。
//
// 登録できる月は、アプリで計算せず、月の一覧（`GET /groups/:id/months`）の `open`（未締め）の月を使う。
import { amountState, evaluateExpression, expressionFromAmount, MAX_AMOUNT_MINOR, type AmountState } from './amountExpression.ts';
import { isRealDate, monthIndex, monthOfDate, todayIn } from './calendar.ts';
import { formatMonthShort } from './dateFormat.ts';
import { formatMoney, formatSignedMoney } from './money.ts';
import type { CreateExpenseRequest, SplitRequest, UpdateExpenseRequest } from '../domain/expense.ts';
import type { GroupMember } from '../domain/group.ts';
import type { Category, ExpenseDetail, MonthListItem } from '../domain/month.ts';
import type { ExpenseFormData } from './expenseService.ts';

/** 内容の長さの上限（前後の空白を落としたあと、コードポイントで数える。Workerの `MAX_DESCRIPTION_LENGTH`） */
export const MAX_DESCRIPTION_LENGTH = 100;
const BASIS_POINTS_TOTAL = 10000;

export type CustomSplitMethod = 'ratio' | 'equal' | 'fixed' | 'single';

/** 「この支出だけ負担を変える」の入力。4つの方法の入力を、切り替えても消えないよう、すべて持つ。 */
export interface SplitDraft {
  method: CustomSplitMethod;
  /** 割合: メンバーIDごとの入力（%。整数部3桁・小数2桁まで）。空は0% */
  percents: Record<string, string>;
  /** 均等: 負担に入れるメンバー */
  equalIds: string[];
  /** 金額指定: メンバーIDごとの金額の式（キーパッドの入力）。空は0 */
  amounts: Record<string, string>;
  /** 1人が全額負担 */
  singleId: string | null;
}

export interface ExpenseDraft {
  /** 金額の式（`amountExpression.ts`） */
  amount: string;
  categoryId: string | null;
  payerMemberId: string | null;
  /** `YYYY-MM-DD` */
  date: string;
  description: string;
  /** 利用者が選んだ登録先の月。`null` は、日付から決める（`targetMonthOf`） */
  monthChoice: string | null;
  /** `null` は、費目の割合で分ける */
  split: SplitDraft | null;
}

export interface ExpenseFormContext {
  currencyCode: string;
  minorUnit: number;
  /** グループのタイムゾーンでの今日 */
  today: string;
  /** グループのタイムゾーンでの今月（月の一覧の `currentMonth`） */
  currentMonth: string;
  months: readonly MonthListItem[];
  /** 登録できる月（古い順）。月の一覧の `open` */
  registerableMonths: readonly string[];
  /** 脱退済み・削除済みも含む全員（名前を引くため） */
  members: readonly GroupMember[];
  /** 費目（並び順どおり。アーカイブ済みも含む） */
  categories: readonly Category[];
  myMemberId: string;
  /** 編集で開いた支出 */
  editing: ExpenseDetail | null;
  /** 締めた月の支出。読み取り専用 */
  readOnly: boolean;
}

/** 読み込んだデータから、シートの文脈を作る。 */
export function buildFormContext(data: ExpenseFormData, now: Date): ExpenseFormContext {
  const { group, months, categories, expense } = data;
  return {
    currencyCode: group.currencyCode,
    minorUnit: group.currencyMinorUnit,
    today: todayIn(now, group.timezone),
    currentMonth: months.currentMonth,
    months: months.months,
    registerableMonths: months.months.filter((item) => item.status === 'open').map((item) => item.month),
    members: group.members,
    categories,
    myMemberId: group.memberId,
    editing: expense,
    readOnly: expense?.closed === true,
  };
}

// --- 月 ---

/** 月の選択肢（登録できる月。編集で開いた支出の月が、登録できない月でも、いまの値として含める） */
export function monthChoices(ctx: ExpenseFormContext): string[] {
  const months = [...ctx.registerableMonths];
  const own = ctx.editing?.targetMonth;
  if (own !== undefined && !months.includes(own)) months.push(own);
  return months.sort();
}

/**
 * 日付から決まる登録先の月。日付の月が登録できる月ならその月。できなければ、登録できる月のうち今月に最も近い月（同じ距離なら
 * 新しいほう）。登録できる月が無ければ `null`。
 */
export function defaultTargetMonth(date: string, ctx: ExpenseFormContext): string | null {
  const dateMonth = monthOfDate(date);
  if (dateMonth !== null && ctx.registerableMonths.includes(dateMonth)) return dateMonth;
  const current = monthIndex(ctx.currentMonth);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const month of ctx.registerableMonths) {
    const index = monthIndex(month);
    if (index === null || current === null) continue;
    const distance = Math.abs(index - current);
    // 同じ距離なら、新しいほう（月は古い順に並ぶので、`<=` で後のものが勝つ）
    if (distance <= bestDistance) {
      best = month;
      bestDistance = distance;
    }
  }
  return best;
}

/** いま登録先になる月（選んでいればその月、選んでいなければ日付から決まる月）。 */
export function targetMonthOf(draft: ExpenseDraft, ctx: ExpenseFormContext): string | null {
  return draft.monthChoice ?? defaultTargetMonth(draft.date, ctx);
}

/** 日付の月に登録できず、別の月に登録することになるときの添え書き（月を選んでいないときだけ）。 */
export function monthNote(draft: ExpenseDraft, ctx: ExpenseFormContext): string | null {
  if (draft.monthChoice !== null) return null;
  const dateMonth = monthOfDate(draft.date);
  const target = defaultTargetMonth(draft.date, ctx);
  if (dateMonth === null || target === null || target === dateMonth) return null;
  const status = ctx.months.find((item) => item.month === dateMonth)?.status;
  const closed = status === 'unsettled' || status === 'settled';
  return closed
    ? `${formatMonthShort(dateMonth)}は締めたため、${formatMonthShort(target)}分として登録します。`
    : `${formatMonthShort(dateMonth)}分は登録できないため、${formatMonthShort(target)}分として登録します。`;
}

// --- メンバー・費目 ---

/** その月の支出の、支払者・負担の対象に選べるメンバー（`worker/src/expenses.ts` の `isMemberAvailable` と同じ規則。サーバーも検べる）。 */
export function isMemberSelectable(member: GroupMember, month: string): boolean {
  // 脱退済み・削除済みは選べない。知らない状態も、安全側（選べない）に倒す
  if (member.status !== 'active' && member.status !== 'leaving') return false;
  if (member.historyFromMonth > month) return false;
  const end = member.expenseEndMonth ?? member.leaveRequestedMonth;
  return end === null || month <= end;
}

/** 支払者の選択肢。編集で開いた支出の支払者は、選べないメンバーでも、いまの値として含める（名前のまま出す）。 */
export function payerOptions(ctx: ExpenseFormContext, month: string | null): GroupMember[] {
  const own = ctx.editing?.payerMemberId;
  return ctx.members.filter(
    (member) => member.id === own || (month !== null && isMemberSelectable(member, month)),
  );
}

/** 負担の対象の選択肢。選べるメンバーと、編集で開いた支出の負担に入っているメンバー。 */
export function splitMembers(ctx: ExpenseFormContext, month: string | null): GroupMember[] {
  const inOriginal = new Set(ctx.editing?.allocations.map((allocation) => allocation.memberId) ?? []);
  return ctx.members.filter(
    (member) => inOriginal.has(member.id) || (month !== null && isMemberSelectable(member, month)),
  );
}

/** 費目の選択肢。アーカイブした費目は選べない（編集で開いた支出の費目は、いまの値として含める）。 */
export function categoryOptions(ctx: ExpenseFormContext): Category[] {
  const own = ctx.editing?.categoryId;
  return ctx.categories.filter((category) => !category.archived || category.id === own);
}

// --- 割合の入力（%） ---

/** 1万分率を、入力欄の文字列にする（`7000` → `70`、`3334` → `33.34`、`3330` → `33.3`）。 */
export function percentText(basisPoints: number): string {
  const integer = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction === '' ? String(integer) : `${integer}.${fraction}`;
}

/** 入力欄の文字列を、1万分率にする。空は0。形が違う・100%を超える値は `null`。 */
export function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return basisPoints <= BASIS_POINTS_TOTAL ? basisPoints : null;
}

/** 均等割りの初期値（端数は、先頭のメンバーから 0.01% ずつ。入力の初期値にするだけで、負担額の計算ではない）。 */
export function equalPercents(memberIds: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const count = memberIds.length;
  if (count === 0) return result;
  const base = Math.floor(BASIS_POINTS_TOTAL / count);
  const remainder = BASIS_POINTS_TOTAL - base * count;
  memberIds.forEach((memberId, index) => {
    result[memberId] = percentText(base + (index < remainder ? 1 : 0));
  });
  return result;
}

// --- 編集で開いた支出の、負担の指定 ---

export type OriginalSplit = { kind: 'known'; split: SplitRequest } | { kind: 'unsupported' };

/**
 * 保存されている支出の負担を、リクエストの形にする。知らない負担の方法（サーバーが足した値）や、読み取れない形は
 * `unsupported`（アプリは変えない。金額も変えられない）。
 */
export function originalSplit(expense: ExpenseDetail): OriginalSplit {
  const { splitMethod, allocations } = expense;
  switch (splitMethod) {
    case 'category':
      return { kind: 'known', split: { method: 'category' } };
    case 'equal':
      return allocations.length === 0
        ? { kind: 'unsupported' }
        : { kind: 'known', split: { method: 'equal', memberIds: allocations.map((row) => row.memberId) } };
    case 'single':
      return allocations.length !== 1
        ? { kind: 'unsupported' }
        : { kind: 'known', split: { method: 'single', memberId: allocations[0]!.memberId } };
    case 'ratio': {
      const shares = allocations.map((row) => ({ memberId: row.memberId, basisPoints: row.shareBasisPoints }));
      if (shares.length === 0 || shares.some((share) => share.basisPoints === null)) return { kind: 'unsupported' };
      const typed = shares as { memberId: string; basisPoints: number }[];
      const total = typed.reduce((sum, share) => sum + share.basisPoints, 0);
      return total === BASIS_POINTS_TOTAL ? { kind: 'known', split: { method: 'ratio', shares: typed } } : { kind: 'unsupported' };
    }
    case 'fixed':
      return allocations.length === 0
        ? { kind: 'unsupported' }
        : {
            kind: 'known',
            split: { method: 'fixed', amounts: allocations.map((row) => ({ memberId: row.memberId, amountMinor: row.burdenMinor })) },
          };
    default:
      return { kind: 'unsupported' };
  }
}

/** 編集で開いた支出の、負担をアプリが変えられない（知らない方法）か。変えられないときは、金額も変えられない。 */
export function splitLocked(ctx: ExpenseFormContext): boolean {
  return ctx.editing !== null && originalSplit(ctx.editing).kind === 'unsupported';
}

// --- 入力の初期値と、負担の入力の切り替え ---

function blankSplitDraft(ctx: ExpenseFormContext, month: string | null, method: CustomSplitMethod): SplitDraft {
  const ids = splitMembers(ctx, month).map((member) => member.id);
  return { method, percents: equalPercents(ids), equalIds: ids, amounts: {}, singleId: null };
}

function splitDraftFromRequest(split: SplitRequest, ctx: ExpenseFormContext, month: string | null): SplitDraft | null {
  if (split.method === 'category') return null;
  const draft = blankSplitDraft(ctx, month, split.method);
  switch (split.method) {
    case 'equal':
      draft.equalIds = [...split.memberIds];
      break;
    case 'ratio': {
      // 並ぶメンバーのうち、保存された割合に無い人は 0%
      for (const key of Object.keys(draft.percents)) draft.percents[key] = '0';
      for (const share of split.shares) draft.percents[share.memberId] = percentText(share.basisPoints);
      break;
    }
    case 'fixed':
      for (const row of split.amounts) draft.amounts[row.memberId] = expressionFromAmount(row.amountMinor, ctx.minorUnit);
      break;
    case 'single':
      draft.singleId = split.memberId;
      break;
  }
  return draft;
}

/**
 * シートを開いたときの入力。新規は、今日・自分が支払う・前回選んだ費目（無ければ先頭）。編集は、保存されている値
 * （金額は式なしで）。
 */
export function initialDraft(ctx: ExpenseFormContext, lastCategoryId: string | null): ExpenseDraft {
  const editing = ctx.editing;
  if (editing !== null) {
    const original = originalSplit(editing);
    return {
      amount: expressionFromAmount(editing.amountMinor, ctx.minorUnit),
      categoryId: editing.categoryId,
      payerMemberId: editing.payerMemberId,
      date: editing.expenseDate,
      description: editing.description ?? '',
      monthChoice: editing.targetMonth,
      split: original.kind === 'known' ? splitDraftFromRequest(original.split, ctx, editing.targetMonth) : null,
    };
  }
  const options = categoryOptions(ctx);
  const category = options.find((option) => option.id === lastCategoryId) ?? options[0];
  const month = defaultTargetMonth(ctx.today, ctx);
  const me = payerOptions(ctx, month).find((member) => member.id === ctx.myMemberId);
  return {
    amount: '',
    categoryId: category?.id ?? null,
    payerMemberId: me?.id ?? null,
    date: ctx.today,
    description: '',
    monthChoice: null,
    split: null,
  };
}

/** 「この支出だけ負担を変える」のオン・オフ。オンにしたときは、全員で均等から始める。 */
export function toggleCustomSplit(draft: ExpenseDraft, ctx: ExpenseFormContext): ExpenseDraft {
  if (draft.split !== null) return { ...draft, split: null };
  return { ...draft, split: blankSplitDraft(ctx, targetMonthOf(draft, ctx), 'equal') };
}

/**
 * 登録先の月を変えたとき、負担の入力に出るメンバーを合わせる（その月に選べないメンバーを外し、選べるようになったメンバーを足す）。
 * 入力済みの値は、残るメンバーでは保つ。
 */
export function syncSplitMembers(draft: ExpenseDraft, ctx: ExpenseFormContext): ExpenseDraft {
  if (draft.split === null) return draft;
  const ids = new Set(splitMembers(ctx, targetMonthOf(draft, ctx)).map((member) => member.id));
  const { split } = draft;
  const percents: Record<string, string> = {};
  const amounts: Record<string, string> = {};
  for (const id of ids) {
    percents[id] = split.percents[id] ?? '0';
    amounts[id] = split.amounts[id] ?? '';
  }
  return {
    ...draft,
    split: {
      ...split,
      percents,
      amounts,
      equalIds: split.equalIds.filter((id) => ids.has(id)),
      singleId: split.singleId !== null && ids.has(split.singleId) ? split.singleId : null,
    },
  };
}

// --- 検査 ---

export interface SplitCheck {
  ok: boolean;
  /** 直す点（入力欄の下に出す） */
  message: string | null;
}

export interface FormCheck {
  amount: AmountState;
  split: SplitCheck | null;
  /** 保存できない理由のうち、最初の1つ（無ければ `null`。金額が空のときは、案内を出さない） */
  blocker: string | null;
  canSave: boolean;
  /** 保存ボタンの文言（「保存 ¥2,000」） */
  saveLabel: string;
}

function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length += 1;
  return length;
}

function checkSplit(
  split: SplitDraft,
  ctx: ExpenseFormContext,
  month: string | null,
  amount: AmountState,
): SplitCheck {
  const ids = splitMembers(ctx, month).map((member) => member.id);
  const money = (value: number) => formatMoney(value, ctx.currencyCode, ctx.minorUnit);
  switch (split.method) {
    case 'ratio': {
      let total = 0;
      for (const id of ids) {
        const basisPoints = parsePercent(split.percents[id] ?? '');
        if (basisPoints === null) return { ok: false, message: '割合は、0から100の数で入力してください（小数は2桁まで）。' };
        total += basisPoints;
      }
      return total === BASIS_POINTS_TOTAL
        ? { ok: true, message: null }
        : { ok: false, message: `合計が100%になるように入力してください（いま ${percentText(total)}%）。` };
    }
    case 'equal':
      return split.equalIds.some((id) => ids.includes(id))
        ? { ok: true, message: null }
        : { ok: false, message: '負担する人を、1人以上選んでください。' };
    case 'single':
      return split.singleId !== null && ids.includes(split.singleId)
        ? { ok: true, message: null }
        : { ok: false, message: '全額を負担する人を選んでください。' };
    case 'fixed': {
      let total = 0;
      for (const id of ids) {
        const result = evaluateExpression(split.amounts[id] ?? '', ctx.minorUnit);
        if (result.kind === 'invalid' || (result.kind === 'value' && (result.minor < 0 || result.minor > MAX_AMOUNT_MINOR))) {
          return { ok: false, message: '金額を読み取れません。入力し直してください。' };
        }
        total += result.kind === 'value' ? result.minor : 0;
      }
      if (amount.kind !== 'ok') return { ok: false, message: '先に、上の金額を入力してください。' };
      return total === amount.minor
        ? { ok: true, message: null }
        : {
            ok: false,
            message: `合計が${money(amount.minor)}になるように入力してください（差 ${formatSignedMoney(total - amount.minor, ctx.currencyCode, ctx.minorUnit)}）。`,
          };
    }
  }
}

function amountBlocker(amount: AmountState, ctx: ExpenseFormContext): string | null {
  switch (amount.kind) {
    case 'invalid':
      return '金額を計算できません。式を直してください。';
    case 'not-positive':
      return '金額は、1以上にしてください。';
    case 'too-large':
      return `金額は、${formatMoney(MAX_AMOUNT_MINOR, ctx.currencyCode, ctx.minorUnit)}以下にしてください。`;
    default:
      return null;
  }
}

/** 入力の検査。保存できるか、できないときの理由、保存ボタンの文言。 */
export function checkDraft(draft: ExpenseDraft, ctx: ExpenseFormContext): FormCheck {
  const amount = amountState(draft.amount, ctx.minorUnit);
  const month = targetMonthOf(draft, ctx);
  const split = draft.split === null ? null : checkSplit(draft.split, ctx, month, amount);
  const saveLabel =
    amount.kind === 'ok' ? `保存 ${formatMoney(amount.minor, ctx.currencyCode, ctx.minorUnit)}` : '保存';

  let blocker: string | null = amountBlocker(amount, ctx);
  if (blocker === null && amount.kind === 'ok' && splitLocked(ctx) && amount.minor !== ctx.editing?.amountMinor) {
    blocker = 'この支出の負担の方法は、このアプリでは変えられないため、金額は変えられません。';
  }
  if (blocker === null && draft.categoryId === null) blocker = 'カテゴリを選んでください。';
  if (blocker === null && draft.payerMemberId === null) blocker = '支払った人を選んでください。';
  if (blocker === null && !isRealDate(draft.date)) blocker = '日付を選んでください。';
  if (blocker === null && month === null) blocker = '登録できる月がありません。';
  if (blocker === null && codePointLength(draft.description.trim()) > MAX_DESCRIPTION_LENGTH) {
    blocker = `内容は、${MAX_DESCRIPTION_LENGTH}文字までにしてください。`;
  }
  if (blocker === null && split !== null && !split.ok) blocker = split.message;

  const canSave = !ctx.readOnly && amount.kind === 'ok' && blocker === null;
  return { amount, split, blocker, canSave, saveLabel };
}

// --- リクエストの組み立て ---

/** 負担の指定。`category`（`draft.split` が `null`）か、「この支出だけ負担を変える」の入力。検査に通らなければ `null`。 */
function buildSplit(draft: ExpenseDraft, ctx: ExpenseFormContext, month: string | null): SplitRequest | null {
  const split = draft.split;
  if (split === null) return { method: 'category' };
  const members = splitMembers(ctx, month).map((member) => member.id);
  switch (split.method) {
    case 'equal': {
      const memberIds = members.filter((id) => split.equalIds.includes(id));
      return memberIds.length === 0 ? null : { method: 'equal', memberIds };
    }
    case 'single':
      return split.singleId !== null && members.includes(split.singleId) ? { method: 'single', memberId: split.singleId } : null;
    case 'ratio': {
      const shares: { memberId: string; basisPoints: number }[] = [];
      for (const memberId of members) {
        const basisPoints = parsePercent(split.percents[memberId] ?? '');
        if (basisPoints === null) return null;
        shares.push({ memberId, basisPoints });
      }
      return shares.reduce((sum, share) => sum + share.basisPoints, 0) === BASIS_POINTS_TOTAL ? { method: 'ratio', shares } : null;
    }
    case 'fixed': {
      const amounts: { memberId: string; amountMinor: number }[] = [];
      for (const memberId of members) {
        const result = evaluateExpression(split.amounts[memberId] ?? '', ctx.minorUnit);
        if (result.kind === 'invalid') return null;
        const minor = result.kind === 'value' ? result.minor : 0;
        if (minor < 0) return null;
        amounts.push({ memberId, amountMinor: minor });
      }
      return { method: 'fixed', amounts };
    }
  }
}

/** 登録のリクエスト。保存できないときは `null`。`id` は、シートを開いたときに1回だけ作った識別子（`CreateExpenseRequest.id`）。 */
export function buildCreateRequest(draft: ExpenseDraft, ctx: ExpenseFormContext, id: string): CreateExpenseRequest | null {
  const check = checkDraft(draft, ctx);
  const month = targetMonthOf(draft, ctx);
  if (!check.canSave || check.amount.kind !== 'ok' || month === null) return null;
  const split = buildSplit(draft, ctx, month);
  if (split === null || draft.categoryId === null || draft.payerMemberId === null) return null;
  const description = draft.description.trim();
  return {
    id,
    expenseDate: draft.date,
    targetMonth: month,
    ...(description === '' ? {} : { description }),
    amountMinor: check.amount.minor,
    categoryId: draft.categoryId,
    payerMemberId: draft.payerMemberId,
    split,
    currencyCode: ctx.currencyCode,
  };
}

function sameSplit(a: SplitRequest, b: SplitRequest): boolean {
  const byMember = <T extends { memberId: string }>(rows: T[]) => [...rows].sort((x, y) => (x.memberId < y.memberId ? -1 : 1));
  switch (a.method) {
    case 'category':
      return b.method === 'category';
    case 'single':
      return b.method === 'single' && a.memberId === b.memberId;
    case 'equal':
      return b.method === 'equal' && JSON.stringify([...a.memberIds].sort()) === JSON.stringify([...b.memberIds].sort());
    case 'ratio':
      return b.method === 'ratio' && JSON.stringify(byMember(a.shares)) === JSON.stringify(byMember(b.shares));
    case 'fixed':
      return b.method === 'fixed' && JSON.stringify(byMember(a.amounts)) === JSON.stringify(byMember(b.amounts));
  }
}

export type UpdatePlan =
  /** 保存できない（検査に通らない） */
  | { kind: 'invalid' }
  /** 何も変えていない（サーバーへ送らず、閉じてよい） */
  | { kind: 'unchanged' }
  | { kind: 'request'; request: UpdateExpenseRequest };

/**
 * 編集のリクエスト。**変えたものだけ**を送る（サーバーは、送らなかった項目を変えない。内容や日付だけの編集で、保存された負担額を
 * 触らない）。金額を変えるときは `currencyCode` を添え、`category` 以外の支出では `split` も添える（サーバーが400で求める。
 * 画面で確認した負担を、サーバーが勝手に計算し直さないため）。負担の指定を変えたときも `split` を送る（`category` に戻すときは
 * `{ method: 'category' }`）。アプリが変えられない負担の方法（`splitLocked`）の支出は、`split` を送らない。
 */
export function buildUpdatePlan(draft: ExpenseDraft, ctx: ExpenseFormContext): UpdatePlan {
  const original = ctx.editing;
  const check = checkDraft(draft, ctx);
  const month = targetMonthOf(draft, ctx);
  if (original === null || !check.canSave || check.amount.kind !== 'ok' || month === null) return { kind: 'invalid' };
  if (draft.categoryId === null || draft.payerMemberId === null) return { kind: 'invalid' };

  const request: UpdateExpenseRequest = {};
  if (draft.date !== original.expenseDate) request.expenseDate = draft.date;
  if (month !== original.targetMonth) request.targetMonth = month;
  const description = draft.description.trim();
  if (description !== (original.description ?? '')) request.description = description === '' ? null : description;
  if (draft.categoryId !== original.categoryId) request.categoryId = draft.categoryId;
  if (draft.payerMemberId !== original.payerMemberId) request.payerMemberId = draft.payerMemberId;

  const amountChanged = check.amount.minor !== original.amountMinor;
  if (amountChanged) {
    request.amountMinor = check.amount.minor;
    request.currencyCode = ctx.currencyCode;
  }

  const originalKind = originalSplit(original);
  if (originalKind.kind === 'known') {
    const split = buildSplit(draft, ctx, month);
    if (split === null) return { kind: 'invalid' };
    const splitChanged = !sameSplit(split, originalKind.split);
    if (splitChanged || (amountChanged && split.method !== 'category')) request.split = split;
  }

  return Object.keys(request).length === 0 ? { kind: 'unchanged' } : { kind: 'request', request };
}
