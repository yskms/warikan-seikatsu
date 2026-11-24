// 負担の指定（「この支出だけ負担を変える」「この固定費だけ負担を変える」）の入力の状態・検査・リクエストの組み立て。
// 支出のシート（`expenseForm.ts`）と、固定費のシート（`recurringForm.ts`）が共有する。画面（RN）には依存しない（`npm test` で守る）。
//
// **負担額の計算は、ここでしない**（CLAUDE.md。負担・精算の計算はWorkerだけが持つ）。割合・均等の端数の配り方を、アプリに
// 書き写さない。ここでするのは、入力の形の検査（合計が100%・金額の合計が一致、など）と、リクエストの組み立てだけ。
// 負担の対象に選べるメンバー（月による）は、呼び出し側が決めて、IDの並びで渡す。
import { evaluateExpression, expressionFromAmount, MAX_AMOUNT_MINOR, type AmountState } from './amountExpression.ts';
import { formatMoney, formatSignedMoney } from './money.ts';
import type { SplitRequest } from '../domain/expense.ts';

const BASIS_POINTS_TOTAL = 10000;

export type CustomSplitMethod = 'ratio' | 'equal' | 'fixed' | 'single';

/** 負担を変える入力。4つの方法の入力を、切り替えても消えないよう、すべて持つ。 */
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

// --- 入力の初期値 ---

/** 全員で均等から始める入力（`memberIds` は、負担の対象に選べるメンバー）。 */
export function blankSplitDraft(memberIds: readonly string[], method: CustomSplitMethod): SplitDraft {
  return { method, percents: equalPercents(memberIds), equalIds: [...memberIds], amounts: {}, singleId: null };
}

/**
 * 保存されている負担を、入力の形にする（`category` は `null`）。`saved` は、保存された負担額（支出だけが持つ）。「金額を指定する」の
 * 初期値にも入れる（割合・均等の支出から切り替えても、「いまの負担額のまま」金額を上げられる。使えないメンバーを含む支出の
 * 金額を上げる回避策。docs/screens.md 4章）。保存値の表示で、計算ではない。
 */
export function splitDraftFromRequest(
  split: SplitRequest,
  memberIds: readonly string[],
  minorUnit: number,
  saved: readonly { memberId: string; burdenMinor: number }[] = [],
): SplitDraft | null {
  if (split.method === 'category') return null;
  const draft = blankSplitDraft(memberIds, split.method);
  for (const row of saved) draft.amounts[row.memberId] = expressionFromAmount(row.burdenMinor, minorUnit);
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
      for (const row of split.amounts) draft.amounts[row.memberId] = expressionFromAmount(row.amountMinor, minorUnit);
      break;
    case 'single':
      draft.singleId = split.memberId;
      break;
  }
  return draft;
}

/** 負担の対象に選べるメンバーが変わったとき、入力を合わせる（外れたメンバーを外し、増えたメンバーを足す。残るメンバーの入力は保つ）。 */
export function syncSplitDraft(split: SplitDraft, memberIds: readonly string[]): SplitDraft {
  const ids = new Set(memberIds);
  const percents: Record<string, string> = {};
  const amounts: Record<string, string> = {};
  for (const id of ids) {
    percents[id] = split.percents[id] ?? '0';
    amounts[id] = split.amounts[id] ?? '';
  }
  return {
    ...split,
    percents,
    amounts,
    equalIds: split.equalIds.filter((id) => ids.has(id)),
    singleId: split.singleId !== null && ids.has(split.singleId) ? split.singleId : null,
  };
}

// --- 検査 ---

export interface SplitCheck {
  ok: boolean;
  /** 直す点（入力欄の下に出す） */
  message: string | null;
}

/**
 * 入力の検査（合計が100%・金額の合計が金額と一致、など）。`amount` は、上の金額の入力の状態（金額指定の合計と比べる）。
 * `memberIds` は、負担の対象に選べるメンバー。
 */
export function checkSplitDraft(
  split: SplitDraft,
  memberIds: readonly string[],
  amount: AmountState,
  currency: { currencyCode: string; minorUnit: number },
): SplitCheck {
  const money = (value: number) => formatMoney(value, currency.currencyCode, currency.minorUnit);
  switch (split.method) {
    case 'ratio': {
      let total = 0;
      for (const id of memberIds) {
        const basisPoints = parsePercent(split.percents[id] ?? '');
        if (basisPoints === null) return { ok: false, message: '割合は、0から100の数で入力してください（小数は2桁まで）。' };
        total += basisPoints;
      }
      return total === BASIS_POINTS_TOTAL
        ? { ok: true, message: null }
        : { ok: false, message: `合計が100%になるように入力してください（いま ${percentText(total)}%）。` };
    }
    case 'equal':
      return split.equalIds.some((id) => memberIds.includes(id))
        ? { ok: true, message: null }
        : { ok: false, message: '負担する人を、1人以上選んでください。' };
    case 'single':
      return split.singleId !== null && memberIds.includes(split.singleId)
        ? { ok: true, message: null }
        : { ok: false, message: '全額を負担する人を選んでください。' };
    case 'fixed': {
      let total = 0;
      for (const id of memberIds) {
        const result = evaluateExpression(split.amounts[id] ?? '', currency.minorUnit);
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
            message: `合計が${money(amount.minor)}になるように入力してください（差 ${formatSignedMoney(total - amount.minor, currency.currencyCode, currency.minorUnit)}）。`,
          };
    }
  }
}

// --- リクエストの組み立て ---

/**
 * 負担の指定。`category`（`split` が `null`）か、負担を変える入力。検査に通らなければ `null`。`memberIds` は、負担の対象に選べるメンバー。
 * 割合・金額指定で、0%・0円のメンバーは送らない（`kept` に入れたメンバーを除く）: 0の行は、負担額が無いのに行が増え、あとで
 * 脱退の確定が、負担に関わっているとみなす（`worker/src/closedMonth.ts` の `markLeftStatement`）。送らなくても、負担は同じ。
 * `kept` は、もともと負担にいたメンバー（変えていない負担を、変えたことにしない）。
 */
export function buildSplitRequest(
  split: SplitDraft | null,
  memberIds: readonly string[],
  minorUnit: number,
  kept: ReadonlySet<string> = new Set(),
): SplitRequest | null {
  if (split === null) return { method: 'category' };
  switch (split.method) {
    case 'equal': {
      const ids = memberIds.filter((id) => split.equalIds.includes(id));
      return ids.length === 0 ? null : { method: 'equal', memberIds: ids };
    }
    case 'single':
      return split.singleId !== null && memberIds.includes(split.singleId) ? { method: 'single', memberId: split.singleId } : null;
    case 'ratio': {
      const shares: { memberId: string; basisPoints: number }[] = [];
      let total = 0;
      for (const memberId of memberIds) {
        const basisPoints = parsePercent(split.percents[memberId] ?? '');
        if (basisPoints === null) return null;
        total += basisPoints;
        if (basisPoints > 0 || kept.has(memberId)) shares.push({ memberId, basisPoints });
      }
      return total === BASIS_POINTS_TOTAL ? { method: 'ratio', shares } : null;
    }
    case 'fixed': {
      const amounts: { memberId: string; amountMinor: number }[] = [];
      for (const memberId of memberIds) {
        const result = evaluateExpression(split.amounts[memberId] ?? '', minorUnit);
        if (result.kind === 'invalid') return null;
        const minor = result.kind === 'value' ? result.minor : 0;
        if (minor < 0) return null;
        if (minor > 0 || kept.has(memberId)) amounts.push({ memberId, amountMinor: minor });
      }
      return { method: 'fixed', amounts };
    }
  }
}

/** 負担に入るメンバーのID（費目の割合・組み立てられない入力は空）。保存が断られたとき、文言を決めるために使う。 */
export function memberIdsOfSplit(split: SplitRequest | null): string[] {
  switch (split?.method) {
    case 'equal':
      return split.memberIds;
    case 'single':
      return [split.memberId];
    case 'ratio':
      return split.shares.map((share) => share.memberId);
    case 'fixed':
      return split.amounts.map((row) => row.memberId);
    default:
      return [];
  }
}

/** 2つの負担の指定が同じか（メンバーの並びは見ない）。 */
export function sameSplit(a: SplitRequest, b: SplitRequest): boolean {
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
