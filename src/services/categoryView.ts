// カテゴリと負担割合の画面（docs/screens.md 6章）に出す内容の組み立て。計算（負担額・端数の配り方）はここでしない
// （Workerだけが持つ）。サーバーの応答を、表示する形にすることだけをする。
import type { CategoryShareRule, CategoryShares } from '../domain/categoryShare.ts';
import type { GroupMember } from '../domain/group.ts';
import type { Category, MonthListItem } from '../domain/month.ts';
import { formatMonth } from './dateFormat.ts';
import { formatShareRatio } from './shareFormat.ts';

/**
 * 割合を出す月を決める。選べるのは、締めていない月（`open`）だけ。`preferred`（ホームで見ている月、いま選んでいる月）が
 * 選べればそれ、選べなければ、今月、今月も選べなければ、選べる月のうち最も古い月（締めていない月のうち、いちばん先に締める月）。
 * 選べる月が無ければ `null`。サーバーの一覧をそのまま使い、月の範囲をアプリで計算しない（実際に直せるかは、読んだ
 * 割合の `editable` で決まる）。
 */
export function pickShareMonth(
  months: readonly MonthListItem[],
  currentMonth: string,
  preferred: string | null,
): string | null {
  const open = months.filter((item) => item.status === 'open').map((item) => item.month);
  if (preferred !== null && open.includes(preferred)) return preferred;
  if (open.includes(currentMonth)) return currentMonth;
  return open[0] ?? null;
}

export interface ShareMonthOption {
  month: string;
  label: string;
  selected: boolean;
}

/** 月の切り替えの選択肢。締めていない月だけ（`open`）。古い月が先（左から右へ進む）。 */
export function buildShareMonthOptions(months: readonly MonthListItem[], selectedMonth: string | null): ShareMonthOption[] {
  return months
    .filter((item) => item.status === 'open')
    .map((item) => ({ month: item.month, label: formatMonth(item.month), selected: item.month === selectedMonth }));
}

/**
 * 割合に入るメンバーの表示順。操作している本人が先、あとはグループのメンバーの並び（参加順）。グループのメンバーに
 * いないID（読み込みのあいだに増えた人）は、最後に、サーバーの順のまま付ける。
 */
export function orderShareMembers(memberIds: readonly string[], members: readonly GroupMember[]): string[] {
  const wanted = new Set(memberIds);
  const known = members.filter((member) => wanted.has(member.id));
  const me = known.filter((member) => member.isMe);
  const others = known.filter((member) => !member.isMe);
  const knownIds = new Set(known.map((member) => member.id));
  return [...me, ...others].map((member) => member.id).concat(memberIds.filter((memberId) => !knownIds.has(memberId)));
}

/** 並び順の費目（`sortOrder`、`id`）のまま。アーカイブした費目は、後ろに分ける（一覧の下に、まとめて出す）。 */
export function splitArchived(categories: readonly Category[]): { active: Category[]; archived: Category[] } {
  return {
    active: categories.filter((category) => !category.archived),
    archived: categories.filter((category) => category.archived),
  };
}

export interface CategoryRow {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  archived: boolean;
  /** 「7:3」「均等」など。その月に割合が無い費目（作る前の月）と、上限額つきの費目（`capText` に含める）は `null` */
  ratioText: string | null;
  /** 上限額つきのときの説明（「月¥10,000まで自分、超えた分 0:10」）。無ければ `null` */
  capText: string | null;
  /** 画面の読み上げ用の、1行の文 */
  summary: string;
}

export interface CategoryRowContext {
  /** 割合に入るメンバーの表示順（`orderShareMembers`） */
  memberOrder: readonly string[];
  memberName(memberId: string): string;
  money(amountMinor: number): string;
}

/** その月の割合の文字（「7:3」「均等」。`order` の表示順）。 */
export function ratioOf(rule: CategoryShareRule, order: readonly string[]): string {
  const byMember = new Map(rule.shares.map((share) => [share.memberId, share.basisPoints]));
  // 表示順のメンバーの割合を並べる。割合に無いメンバーは出さない（`PUT` は、全員を送らないと断られるので、通常は全員いる）
  return formatShareRatio(order.filter((memberId) => byMember.has(memberId)).map((memberId) => byMember.get(memberId)!));
}

/**
 * 上限額つきのときの説明（「月¥10,000まで自分、超えた分 0:10」）。無ければ `null`。`ratioText` は、「超えた分」の割合の文字
 * （省略すると `ratioOf`。ホームの内訳は、メンバーの並びを添えた文字を渡す。空なら、「超えた分」は付けない）。
 */
export function capTextOf(
  rule: CategoryShareRule,
  ctx: Pick<CategoryRowContext, 'money' | 'memberName'> & { memberOrder: readonly string[] },
  ratioText: string = ratioOf(rule, ctx.memberOrder),
): string | null {
  if (rule.cap === null) return null;
  const head = `月${ctx.money(rule.cap.capMinor)}まで${ctx.memberName(rule.cap.memberId)}`;
  // 割合が空（割合の行が無い）のときは、「超えた分」を付けない（末尾が欠けた文字にしない）
  return ratioText === '' ? head : `${head}、超えた分 ${ratioText}`;
}

/**
 * 一覧の行。費目は並び順のまま。割合は、`shares` の費目（その月に割合がある費目）から引く。
 */
export function buildCategoryRows(
  categories: readonly Category[],
  shares: CategoryShares | null,
  ctx: CategoryRowContext,
): CategoryRow[] {
  const rules = new Map((shares?.categories ?? []).map((rule) => [rule.categoryId, rule]));
  return categories.map((category) => {
    const rule = rules.get(category.id);
    // 上限額つきの行は、上限の説明が割合を含む（「月¥10,000まで自分、超えた分 0:10」）ので、割合だけの文字は出さない
    const capText = rule === undefined ? null : capTextOf(rule, ctx);
    const ratioText = rule === undefined || capText !== null ? null : ratioOf(rule, ctx.memberOrder);
    const detail = capText ?? ratioText;
    return {
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      archived: category.archived,
      ratioText,
      capText,
      summary: detail === null ? category.name : `${category.name}、${detail}`,
    };
  });
}
