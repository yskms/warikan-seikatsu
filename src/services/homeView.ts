// ホーム（docs/screens.md 3章）に出す内容を、サーバーの応答から組み立てる（画面は、ここの結果を並べるだけ）。
// **負担・精算の計算はしない**（Workerの `computeMonthFromState` だけが計算する。CLAUDE.md）。ここでやるのは、応答の値を
// 表示する形にすること（名前の引き当て、金額の文字列、状態の文言）と、お知らせの出し分けだけ。
import type { GroupDetail } from '../domain/group.ts';
import type {
  Category,
  CloseState,
  Expense,
  MonthListItem,
  MonthListStatus,
  MonthStatus,
  MonthView,
  TransferStatus,
} from '../domain/month.ts';
import { formatExpenseDate, formatMonth, formatMonthShort, nextMonth, previousMonth } from './dateFormat.ts';
import { formatMoney, formatSignedMoney } from './money.ts';

const UNKNOWN_MEMBER = '不明なメンバー';
const UNKNOWN_CATEGORY = '不明な費目';

/** 金額を、グループの通貨で表示する関数。 */
export type MoneyFormatter = (amountMinor: number) => string;
export type SignedMoneyFormatter = MoneyFormatter;

export function moneyFormatters(group: Pick<GroupDetail, 'currencyCode' | 'currencyMinorUnit'>): {
  money: MoneyFormatter;
  signed: SignedMoneyFormatter;
} {
  return {
    money: (amountMinor) => formatMoney(amountMinor, group.currencyCode, group.currencyMinorUnit),
    signed: (amountMinor) => formatSignedMoney(amountMinor, group.currencyCode, group.currencyMinorUnit),
  };
}

/** メンバーの名前と色を引く。月の集計の名前（締めた月は、締めた時点の名前）を先に使い、無ければグループのメンバー。 */
export interface MemberLookup {
  name(memberId: string): string;
  /** 色のキー。分からなければ `gray` */
  color(memberId: string): string;
}

export function memberLookup(group: Pick<GroupDetail, 'members'>, summary?: Pick<MonthView, 'members'>): MemberLookup {
  const names = new Map<string, string>();
  for (const member of group.members) names.set(member.id, member.displayName);
  // 月の集計の名前を優先する（締めた月は、締めた時点の名前が正しい）
  for (const member of summary?.members ?? []) names.set(member.memberId, member.displayName);
  const colors = new Map(group.members.map((member) => [member.id, member.color]));
  return {
    name: (memberId) => names.get(memberId) ?? UNKNOWN_MEMBER,
    color: (memberId) => colors.get(memberId) ?? 'gray',
  };
}

/** アイコンに出す頭文字（名前の最初の1文字。コードポイントで数える）。 */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?';
}

// ---------------------------------------------------------------------------
// 月の切り替え

const STATUS_LABELS: Record<MonthStatus, string> = {
  open: '未締め',
  skipped: '締めずに飛ばした月',
  unsettled: '精算が残っています',
  settled: '処理済み',
};

/** 知らない状態（サーバーが足した値。`MonthListStatus`）は、印を出さない（空の文字列）。 */
export function monthStatusLabel(status: MonthListStatus): string {
  return status === 'unknown' ? '' : STATUS_LABELS[status];
}

export interface MonthOption {
  month: string;
  label: string;
  statusLabel: string;
  selected: boolean;
}

/** 月のピッカーの選択肢。新しい月を上に並べる（サーバーの一覧は古い順）。 */
export function buildMonthOptions(months: readonly MonthListItem[], selectedMonth: string): MonthOption[] {
  return [...months].reverse().map((item) => ({
    month: item.month,
    label: formatMonth(item.month),
    statusLabel: monthStatusLabel(item.status),
    selected: item.month === selectedMonth,
  }));
}

/** 前・次の月（一覧の中だけ。一覧の端、または一覧に無い月は `null`）。 */
export function neighborMonths(
  months: readonly MonthListItem[],
  selectedMonth: string,
): { previous: string | null; next: string | null } {
  const index = months.findIndex((item) => item.month === selectedMonth);
  if (index < 0) return { previous: null, next: null };
  return { previous: months[index - 1]?.month ?? null, next: months[index + 1]?.month ?? null };
}

// ---------------------------------------------------------------------------
// お知らせ

export interface Notice {
  kind: 'previous-open' | 'previous-unsettled';
  /** タップで移る月 */
  month: string;
  message: string;
}

/**
 * 選んだ月の1つ前の月について、締めていない・精算が残っているときのお知らせ（タップで、その月へ移る）。
 * 一覧に無い月（参加前など）には出さない。締めずに飛ばした月（`skipped`）は、もう締められないので出さない。
 *
 * 「前の月が未締め」は、**選んだ月の `close` が、前の月を先に締めるよう求めているとき**（`previous_month_not_closed`）だけ出す。
 * 前の月が未締めでも、グループで最初の月は、前の月を締めずに締められる（Workerの `evaluateClose` の例外。作成月に支出が無く、
 * 翌月に最初の支出を登録したグループなど。docs/backend-design.md 4章）。その月まで「先に締めてください」と促すと、締められる
 * という `close` と食い違う。この規則はアプリに書き写さず、サーバーの答えに従う。
 *
 * メンバーが増減したお知らせ・固定費が止まったお知らせ（screens.md 3章）は、それを返すAPIを読む画面ができるときに足す。
 */
export function buildNotices(selectedMonth: string, months: readonly MonthListItem[], close: CloseState): Notice[] {
  const previous = previousMonth(selectedMonth);
  const item = previous === null ? undefined : months.find((entry) => entry.month === previous);
  if (!item) return [];
  const label = formatMonthShort(item.month);
  if (item.status === 'open') {
    if (close.closable || close.reason !== 'previous_month_not_closed') return [];
    return [{ kind: 'previous-open', month: item.month, message: `${label}がまだ締められていません` }];
  }
  if (item.status === 'unsettled') {
    return [{ kind: 'previous-unsettled', month: item.month, message: `${label}分の精算が残っています` }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 総額・メンバー別の負担額

export interface TotalModel {
  title: string;
  amountText: string;
  /** 締めた月だけ */
  closedBadge: string | null;
}

export function buildTotal(summary: MonthView, money: MoneyFormatter): TotalModel {
  return {
    title: `${formatMonth(summary.month)}の共同支出`,
    amountText: money(summary.totalMinor),
    closedBadge: summary.closed ? '締め済み' : null,
  };
}

export interface MemberBurden {
  memberId: string;
  name: string;
  initial: string;
  color: string;
  /** その月の負担額。繰越は含めない */
  burdenText: string;
}

export function buildMemberBurdens(summary: MonthView, lookup: MemberLookup, money: MoneyFormatter): MemberBurden[] {
  return summary.members.map((member) => ({
    memberId: member.memberId,
    name: lookup.name(member.memberId),
    initial: initialOf(lookup.name(member.memberId)),
    color: lookup.color(member.memberId),
    burdenText: money(member.burdenMinor),
  }));
}

/** メンバー別の横並びの列数（3人までは横一列。4人以上は折り返す。screens.md 3章） */
export function memberColumns(count: number): number {
  if (count <= 3) return Math.max(count, 1);
  return count === 4 ? 2 : 3;
}

// ---------------------------------------------------------------------------
// 内訳

export interface Breakdown {
  members: {
    memberId: string;
    name: string;
    paidText: string;
    burdenText: string;
    differenceText: string;
    /** 繰越があるときだけ */
    carriedInText: string | null;
  }[];
  categories: {
    categoryId: string;
    name: string;
    icon: string;
    color: string;
    totalText: string;
    /** メンバーごとの負担額（負担額が0のメンバーは、応答に行が無いことがある） */
    burdens: { memberId: string; name: string; burdenText: string }[];
  }[];
}

export function buildBreakdown(
  summary: MonthView,
  lookup: MemberLookup,
  categories: readonly Category[],
  formatters: { money: MoneyFormatter; signed: SignedMoneyFormatter },
): Breakdown {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return {
    members: summary.members.map((member) => ({
      memberId: member.memberId,
      name: lookup.name(member.memberId),
      paidText: formatters.money(member.paidMinor),
      burdenText: formatters.money(member.burdenMinor),
      differenceText: formatters.signed(member.differenceMinor),
      carriedInText: member.carriedInMinor === 0 ? null : formatters.signed(member.carriedInMinor),
    })),
    categories: summary.categories.map((row) => {
      const category = categoryById.get(row.categoryId);
      return {
        categoryId: row.categoryId,
        name: category?.name ?? UNKNOWN_CATEGORY,
        icon: category?.icon ?? 'more',
        color: category?.color ?? 'gray',
        totalText: formatters.money(row.totalMinor),
        burdens: row.burdens.map((burden) => ({
          memberId: burden.memberId,
          name: lookup.name(burden.memberId),
          burdenText: formatters.money(burden.burdenMinor),
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 精算

const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pending: '未処理',
  settled: '精算済み',
  carried: '繰越済み',
};

export interface TransferLine {
  key: string;
  /** 締めた月の送金のID（精算完了・繰越に渡す）。締める前の見込みは `null` */
  transferId: string | null;
  fromName: string;
  toName: string;
  amountText: string;
  /** 締めた月だけ（未処理・精算済み・繰越済み） */
  statusText: string | null;
  /** 未処理か（締めた月だけ。操作のボタンを出す送金） */
  pending: boolean;
  /** 未処理で、繰り越せるか（サーバーが返す `canCarry`。アプリは規則を持たない）。未処理でない送金は `false` */
  canCarry: boolean;
}

export type SettlementModel =
  | {
      kind: 'estimate';
      title: string;
      lines: TransferLine[];
      /** 先月からの繰越を含むときだけ */
      carryNote: string | null;
      /** 送金が無いとき */
      emptyText: string | null;
      /** 締められない理由（締められるとき、または理由を出さないときは `null`） */
      blockedText: string | null;
      /** 「この月を締める」を押せるか（サーバーが返す `close.closable`） */
      closable: boolean;
    }
  | {
      kind: 'closed';
      title: string;
      /** 未処理の件数の文言（未処理が無ければ `null`） */
      pendingText: string | null;
      lines: TransferLine[];
      /** すべて処理済みのとき */
      doneText: string | null;
      /** 繰越先の月の名前（「12月」。繰越の確認に出す）。繰越先はサーバーが決める。ここは表示用 */
      carryMonthLabel: string;
    };

/** 締められない理由（締める前の月）。締められるとき・月が締め済みのときは `null`。 */
export function closeBlockedText(close: CloseState): string | null {
  if (close.closable) return null;
  const previous = close.month === null ? '前の月' : formatMonthShort(close.month);
  switch (close.reason) {
    case 'previous_month_not_closed':
      return `先に${previous}を締めてください`;
    case 'previous_month_unsettled':
      return `先に${previous}分の精算を済ませてください`;
    case 'month_not_started':
      return 'この月は、まだ始まっていません';
    case 'month_skipped':
      return 'この月は、締めずに次の月へ進んだため、締められません';
    case 'forbidden':
      return 'この月は、あなたが締められる月ではありません';
    case 'unknown':
      // サーバーが足した理由（古い版のアプリは知らない）。理由は言えないが、押せない理由が無いのは不親切
      return 'いまは、この月を締められません';
    case 'month_closed':
      return null;
  }
}

export function buildSettlement(
  summary: MonthView,
  lookup: MemberLookup,
  money: MoneyFormatter,
): SettlementModel {
  const lines: TransferLine[] = summary.transfers.map((transfer, index) => {
    const pending = transfer.kind === 'closed' && transfer.status === 'pending';
    return {
      key: transfer.kind === 'closed' ? transfer.id : `estimate-${index}`,
      transferId: transfer.kind === 'closed' ? transfer.id : null,
      fromName: lookup.name(transfer.fromMemberId),
      toName: lookup.name(transfer.toMemberId),
      amountText: money(transfer.amountMinor),
      statusText: transfer.kind === 'closed' ? TRANSFER_STATUS_LABELS[transfer.status] : null,
      pending,
      canCarry: pending && transfer.kind === 'closed' && transfer.canCarry,
    };
  });
  const monthLabel = formatMonthShort(summary.month);

  if (summary.closed) {
    const pending = lines.filter((line) => line.pending).length;
    const following = nextMonth(summary.month);
    return {
      kind: 'closed',
      title: `${monthLabel}の精算`,
      pendingText: pending > 0 ? `未処理 ${pending}件` : null,
      lines,
      doneText: summary.closing?.processed ? `${monthLabel}分は処理済みです` : null,
      carryMonthLabel: following === null ? '次の月' : formatMonthShort(following),
    };
  }

  // 繰越は、送金先なら足し、送金元なら引く値で、全員を足すと0になる。「含む」額は、足す側（正の値）の合計
  const carried = summary.members.reduce((sum, member) => sum + Math.max(member.carriedInMinor, 0), 0);
  return {
    kind: 'estimate',
    title: 'いまの精算見込み',
    lines,
    carryNote: carried > 0 ? `先月からの繰越 ${money(carried)} を含みます` : null,
    emptyText: lines.length === 0 ? 'いまのところ精算はありません' : null,
    blockedText: closeBlockedText(summary.close),
    closable: summary.close.closable,
  };
}

// ---------------------------------------------------------------------------
// 精算完了・繰越の確認（docs/screens.md 5章）

export interface ConfirmText {
  title: string;
  message: string;
  /** 実行のボタンの文字 */
  confirmLabel: string;
}

/** 「精算完了」の確認。 */
export function settleConfirmText(line: TransferLine): ConfirmText {
  return {
    title: `${line.fromName} → ${line.toName} ${line.amountText} を精算済みにします。`,
    message: '元に戻せません。',
    confirmLabel: '精算済みにする',
  };
}

/** 「繰越」の確認。`carryMonthLabel` は、繰越先の月（`SettlementModel` の `carryMonthLabel`。「12月」）。 */
export function carryConfirmText(line: TransferLine, carryMonthLabel: string): ConfirmText {
  return {
    title: `${line.amountText} を${carryMonthLabel}の精算に合算します。`,
    message: `${line.fromName} → ${line.toName} の送金です。元に戻せません。`,
    confirmLabel: '繰り越す',
  };
}

/** 繰り越せない未処理の送金（脱退するメンバー・削除されたユーザーが関わる）に添える一言。 */
export const CARRY_BLOCKED_TEXT = '脱退するメンバーや削除されたユーザーが関わる送金は、繰り越せません';

// ---------------------------------------------------------------------------
// 支出の一覧

export interface ExpenseRow {
  id: string;
  /** 内容。無ければ費目名 */
  title: string;
  /** 内容があるときは費目名、日付、支払った人（内容が無いときは、費目名を出さない） */
  subtitle: string;
  icon: string;
  color: string;
  amountText: string;
  /** 小さな印（「この支出だけ負担を変える」を付けた支出、固定費から作られた支出） */
  badges: string[];
}

export function buildExpenseRows(
  expenses: readonly Expense[],
  categories: readonly Category[],
  lookup: MemberLookup,
  money: MoneyFormatter,
): ExpenseRow[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return expenses.map((expense) => {
    const category = categoryById.get(expense.categoryId);
    const categoryName = category?.name ?? UNKNOWN_CATEGORY;
    const description = expense.description?.trim() ?? '';
    const meta = `${formatExpenseDate(expense.expenseDate)}・${lookup.name(expense.payerMemberId)}`;
    const badges: string[] = [];
    if (expense.splitMethod !== 'category') badges.push('負担を変更');
    if (expense.recurringExpenseId !== null) badges.push('固定費');
    return {
      id: expense.id,
      title: description === '' ? categoryName : description,
      subtitle: description === '' ? meta : `${categoryName}・${meta}`,
      icon: category?.icon ?? 'more',
      color: category?.color ?? 'gray',
      amountText: money(expense.amountMinor),
      badges,
    };
  });
}
