// 固定費の一覧（docs/screens.md 6章の「固定費」）に出す内容の組み立て。計算（負担額・予定日）はここでしない（Workerだけが持つ）。
// サーバーの応答を、表示する形にすることだけをする。
import type { SplitRequest } from '../domain/expense.ts';
import type { RecurringExpense } from '../domain/recurring.ts';
import { formatMonth } from './dateFormat.ts';
import { memberLookup, moneyFormatters, type MoneyFormatter } from './homeView.ts';
import type { RecurringData } from './recurringService.ts';
import { percentText } from './splitForm.ts';

/**
 * 一覧での区分。`ended` は、終了する月が今月より前（もう作らない）。それ以外で、止まっていれば `paused`。
 * 終了したものは、止まっていても `ended`（止めた理由の案内は、もう要らない）。区分は表示にしか使わない
 * （作る・作らないを決めるのは、サーバー）。
 */
export type RecurringStatus = 'active' | 'paused' | 'ended';

export interface RecurringRow {
  id: string;
  /** 内容（無ければ、カテゴリの名前） */
  title: string;
  amountText: string;
  /** 「毎月25日・支払う人 ○○・食費」 */
  detailText: string;
  categoryIcon: string;
  categoryColor: string;
  status: RecurringStatus;
  /** 状態の文言（止まっている理由・終了・自動登録されていない）。無ければ `null` */
  statusText: string | null;
  /** 状態の文言を、注意として強く出すか（止まっている・自動登録されていない） */
  attention: boolean;
  /** この固定費だけ負担を変えているか（負担の方法が、カテゴリの割合以外） */
  customSplit: boolean;
  /** 読み上げ */
  label: string;
}

export interface RecurringSections {
  /** 止まっている（上にまとめて、理由を出す） */
  paused: RecurringRow[];
  /** 登録している（サーバーの順） */
  active: RecurringRow[];
  /** 終了した（下に薄く） */
  ended: RecurringRow[];
}

/** 毎月の日の文言（「毎月25日」）。 */
export function dayText(dayOfMonth: number): string {
  return `毎月${dayOfMonth}日`;
}

/** 29〜31日の添え書き（その日が無い月の扱い）。それ以外は `null`。 */
export function dayNote(dayOfMonth: number): string | null {
  return dayOfMonth >= 29 ? 'その日がない月は、月末日に登録します。' : null;
}

/** 止めた理由の文言。止まっていなければ `null`。 */
export function pausedReasonText(item: Pick<RecurringExpense, 'pausedAt' | 'pausedReason'>): string | null {
  if (item.pausedAt === null) return null;
  switch (item.pausedReason) {
    case 'manual':
      return '止めています';
    case 'payer_left':
      return '支払う人が脱退しました。支払う人を選び直してください';
    case 'member_changed':
      return 'メンバーが変わったため、負担の見直しが必要です';
    default:
      // 理由が無い・知らない理由（サーバーが足した値）
      return '止まっています';
  }
}

/** カテゴリを使わない設定にしている固定費の案内（一覧の行と、編集のシート）。 */
export const CATEGORY_ARCHIVED_TEXT = '自動登録されていません（カテゴリが「使わない」設定です）';

/**
 * カテゴリを使わない設定にしている固定費の、編集のシートの説明。見送られていた今月の分は、カテゴリを戻しても、選び直しても、
 * すぐあとに作られる（docs/backend-design.md 9章の「固定費API」）。手で入力済みなら二重になる。
 */
export const CATEGORY_ARCHIVED_HELP =
  'カテゴリを「また使う」に戻すか、別のカテゴリに選び直してください。今月の分が見送られていた場合は、そのあとすぐに登録されます。' +
  '手で入力した分があれば、あとで片方を削除してください。';

export function statusOf(item: RecurringExpense, currentMonth: string): RecurringStatus {
  if (item.endMonth !== null && item.endMonth < currentMonth) return 'ended';
  return item.pausedAt !== null ? 'paused' : 'active';
}

export function buildRecurringSections(data: RecurringData): RecurringSections {
  const lookup = memberLookup(data.group);
  const { money } = moneyFormatters(data.group);
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const sections: RecurringSections = { paused: [], active: [], ended: [] };
  for (const item of data.recurring) {
    const category = categories.get(item.categoryId);
    const categoryName = category?.name ?? '不明なカテゴリ';
    const status = statusOf(item, data.months.currentMonth);
    let statusText: string | null = null;
    let attention = false;
    if (status === 'ended') {
      statusText = item.endMonth === null ? null : `${formatMonth(item.endMonth)}で終了しました`;
    } else if (status === 'paused') {
      statusText = pausedReasonText(item);
      attention = true;
    } else if (item.categoryArchived) {
      statusText = CATEGORY_ARCHIVED_TEXT;
      attention = true;
    }
    const title = item.description ?? categoryName;
    const amountText = money(item.amountMinor);
    const detailText = `${dayText(item.dayOfMonth)}・支払う人 ${lookup.name(item.payerMemberId)}・${categoryName}`;
    const customSplit = item.split === null || item.split.method !== 'category';
    const row: RecurringRow = {
      id: item.id,
      title,
      amountText,
      detailText,
      categoryIcon: category?.icon ?? '',
      categoryColor: category?.color ?? 'gray',
      status,
      statusText,
      attention,
      customSplit,
      label: [title, amountText, detailText, customSplit ? 'この固定費だけ負担を変えています' : null, statusText]
        .filter((part): part is string => part !== null)
        .join('、'),
    };
    sections[status].push(row);
  }
  return sections;
}

/**
 * 負担の指定の文言（再開の確認に出す。止まっていたあいだにメンバーが変わっていないか、見てもらう）。入力した値を、そのまま文に
 * するだけで、負担額は計算しない（割合・均等の端数の配り方は、Workerだけが持つ）。
 */
export function describeSplit(split: SplitRequest, nameOf: (memberId: string) => string, money: MoneyFormatter): string {
  switch (split.method) {
    case 'category':
      return 'カテゴリの割合で分けます';
    case 'equal':
      return `${split.memberIds.map(nameOf).join('、')}で均等に分けます`;
    case 'ratio':
      return split.shares.map((share) => `${nameOf(share.memberId)} ${percentText(share.basisPoints)}%`).join('、');
    case 'fixed':
      return split.amounts.map((row) => `${nameOf(row.memberId)} ${money(row.amountMinor)}`).join('、');
    case 'single':
      return `${nameOf(split.memberId)}が全額負担します`;
  }
}
