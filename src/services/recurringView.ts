// 固定費の一覧（docs/screens.md 6章の「固定費」）に出す内容の組み立て。計算（負担額・予定日）はここでしない（Workerだけが持つ）。
// サーバーの応答を、表示する形にすることだけをする。
import type { SplitRequest } from '../domain/expense.ts';
import type { GroupMember } from '../domain/group.ts';
import type { Category } from '../domain/month.ts';
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

export function statusOf(
  item: Pick<RecurringExpense, 'endMonth' | 'pausedAt'>,
  currentMonth: string,
): RecurringStatus {
  if (item.endMonth !== null && item.endMonth < currentMonth) return 'ended';
  return item.pausedAt !== null ? 'paused' : 'active';
}

const UNKNOWN_CATEGORY_NAME = '不明なカテゴリ';

/** 固定費の題。内容が無ければ、カテゴリの名前（一覧の行・ホームのお知らせ・脱退の欄の添え書きで同じにする）。 */
export function recurringTitle(
  item: Pick<RecurringExpense, 'description' | 'categoryId'>,
  categories: ReadonlyMap<string, Pick<Category, 'name'>>,
): string {
  return item.description ?? categories.get(item.categoryId)?.name ?? UNKNOWN_CATEGORY_NAME;
}

export function buildRecurringSections(data: RecurringData): RecurringSections {
  const lookup = memberLookup(data.group);
  const { money } = moneyFormatters(data.group);
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const sections: RecurringSections = { paused: [], active: [], ended: [] };
  for (const item of data.recurring) {
    const category = categories.get(item.categoryId);
    const categoryName = category?.name ?? UNKNOWN_CATEGORY_NAME;
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
    const title = recurringTitle(item, categories);
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

// ---------------------------------------------------------------------------
// ホームのお知らせ（docs/screens.md 3章）

export interface RecurringNotice {
  kind: 'recurring-paused' | 'recurring-payer-leaving';
  message: string;
  /** タップ先。1件なら、その固定費の編集のシート。複数なら、固定費の一覧 */
  target: { kind: 'edit'; recurringId: string } | { kind: 'list' };
}

export interface RecurringNoticeInput {
  /** 読めなかったときは `null`（お知らせを出さない。`HomeGroupData.recurring`） */
  recurring: readonly RecurringExpense[] | null;
  /** 見ている本人のメンバーID（`GroupDetail.memberId`） */
  memberId: string;
  /** 支払う人の脱退を見る（`leaveRequestedMonth`・`leaveEffective`。サーバーの値。月の判定は書き写さない） */
  members: readonly Pick<GroupMember, 'id' | 'leaveRequestedMonth' | 'expenseEndMonth' | 'leaveEffective'>[];
  /** 自分が脱退を選んで確定したら、グループが消えるか（`GroupDetail.leaveDeletesGroup`。サーバーの値） */
  leaveDeletesGroup: boolean;
  categories: readonly Pick<Category, 'id' | 'name'>[];
  /** グループの今月（月の一覧の `currentMonth`）。終了した固定費を除くために使う */
  currentMonth: string;
}

/** 止まった固定費に、次にしてほしいこと。理由が知らない値・無いときは、確認を促す */
function pausedAction(reason: RecurringExpense['pausedReason']): string {
  switch (reason) {
    case 'payer_left':
      return '支払う人を選び直してください';
    case 'member_changed':
      return '負担の分け方を見直してください';
    default:
      return '内容を確認してください';
  }
}

/**
 * ホームのお知らせのうち、固定費に関するもの。**1つの種類につき、お知らせは1つだけ**（1件ならその固定費の編集へ、複数なら
 * 固定費の一覧へ。固定費は50件まで持て、メンバーの増減で、個別の負担の固定費がまとめて止まるので、1件ずつ重ねない）。
 *
 * - **止まった（`recurring-paused`）**: 止まっている固定費（終了したものを除く）のうち、**手動で止めたもの（`manual`）は出さない**
 *   （自分たちで止めたので、知らせることが無い）。知らない理由・理由が無いものは、出す（自動登録が止まっているのに、黙らない）。
 * - **支払う人が脱退予定（`recurring-payer-leaving`）**: まだ止まっていない固定費で、支払う人が脱退を選んでいる（確定する前。
 *   確定すると、サーバーが止める）もの。設計は、支払う人の付け替えのアラートを、脱退を選んだ時点から出す（docs/backend-design.md
 *   5章の「脱退」）。付け替えれば、止まらずに続く。
 *
 * 止まった理由・支払う人の脱退は、サーバーの値で見る（脱退の確定・止まる条件は書き写さない）。
 *
 * - **自分の脱退が有効（`leaveEffective`。精算を待っている人、Cronの確定の前に脱退月が終わった人）なら、どちらも出さない**:
 *   サーバーは、その人の固定費の変更を403で断る（`canEditGroupSettings`）ので、「選び直してください」と促しても、直せない。
 * - 支払う人が脱退予定のお知らせは、**グループが消える（`leaveDeletesGroup`。最後の1人）ときは出さない**（固定費も一緒に消える）。
 *   また、**終了する月が、支払う人の脱退月以前の固定費は含めない**（脱退が確定したあとに作る予定が無いので、付け替えは要らない）。
 */
export function buildRecurringNotices(input: RecurringNoticeInput): RecurringNotice[] {
  const { recurring, members, currentMonth } = input;
  if (recurring === null) return [];
  if (members.find((member) => member.id === input.memberId)?.leaveEffective === true) return [];
  const categories = new Map(input.categories.map((category) => [category.id, category]));
  const notices: RecurringNotice[] = [];

  const paused = recurring.filter((item) => statusOf(item, currentMonth) === 'paused' && item.pausedReason !== 'manual');
  const only = paused.length === 1 ? paused[0] : undefined;
  if (only !== undefined) {
    notices.push({
      kind: 'recurring-paused',
      message: `${recurringTitle(only, categories)}の固定費が止まっています。${pausedAction(only.pausedReason)}`,
      target: { kind: 'edit', recurringId: only.id },
    });
  } else if (paused.length >= 2) {
    const actions = new Set(paused.map((item) => pausedAction(item.pausedReason)));
    const action = actions.size === 1 ? [...actions][0] : '内容を確認してください';
    notices.push({
      kind: 'recurring-paused',
      message: `固定費が${paused.length}件止まっています。${action}`,
      target: { kind: 'list' },
    });
  }

  // 支払う人が脱退を選んでいる（または有効になった）メンバー → 脱退月（`YYYY-MM`。分からなければ `null`）
  const leaving = new Map(
    members
      .filter((member) => member.leaveRequestedMonth !== null || member.leaveEffective)
      .map((member) => [member.id, member.leaveRequestedMonth ?? member.expenseEndMonth] as const),
  );
  const payerLeaving = input.leaveDeletesGroup
    ? []
    : recurring.filter((item) => {
        if (statusOf(item, currentMonth) !== 'active' || !leaving.has(item.payerMemberId)) return false;
        const leaveMonth = leaving.get(item.payerMemberId) ?? null;
        // 脱退月で終わる（それ以前に終わる）固定費は、脱退の確定のあとに作る予定が無い
        return !(item.endMonth !== null && leaveMonth !== null && item.endMonth <= leaveMonth);
      });
  const onlyLeaving = payerLeaving.length === 1 ? payerLeaving[0] : undefined;
  if (onlyLeaving !== undefined) {
    notices.push({
      kind: 'recurring-payer-leaving',
      message: `${recurringTitle(onlyLeaving, categories)}の固定費は、支払う人が脱退予定です。支払う人を選び直してください`,
      target: { kind: 'edit', recurringId: onlyLeaving.id },
    });
  } else if (payerLeaving.length >= 2) {
    notices.push({
      kind: 'recurring-payer-leaving',
      message: `固定費${payerLeaving.length}件の支払う人が脱退予定です。支払う人を選び直してください`,
      target: { kind: 'list' },
    });
  }
  return notices;
}

/**
 * 自分が支払う人の、止まっていない（手動で止めたものも含めて、止まっているものは除く）・終了していない固定費の題。脱退の欄の
 * 添え書き（`leaveView.ts`）に使う。サーバーは、脱退が確定すると、支払う人が脱退した固定費を止める（付け替えていなければ）。
 * 脱退月は今月なので、**終了する月が今月以前の固定費は含めない**（今月で終わる固定費は、脱退が確定したあとに作る予定が無く、
 * 付け替えは要らない）。
 */
export function myPayerRecurringTitles(input: {
  recurring: readonly RecurringExpense[];
  categories: readonly Pick<Category, 'id' | 'name'>[];
  currentMonth: string;
  memberId: string;
}): string[] {
  const categories = new Map(input.categories.map((category) => [category.id, category]));
  return input.recurring
    .filter(
      (item) =>
        item.payerMemberId === input.memberId &&
        statusOf(item, input.currentMonth) === 'active' &&
        !(item.endMonth !== null && item.endMonth <= input.currentMonth),
    )
    .map((item) => recurringTitle(item, categories));
}
