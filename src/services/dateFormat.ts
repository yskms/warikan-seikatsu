// 月・日付の表示と、月の計算（`YYYY-MM`・`YYYY-MM-DD`。docs/backend-design.md 9章の「共通」）。
// どの月を選べるかは、サーバーが返す一覧をそのまま使い、ここでは計算しない（`previousMonth` は、画面に出す
// お知らせが、1つ前の月を探すためだけに使う）。

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** `2026-11` → `2026年11月`。形が違う値は、そのまま返す。 */
export function formatMonth(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  return match ? `${match[1]}年${Number(match[2])}月` : month;
}

/** `2026-11` → `11月`（年が分かる文脈で使う）。 */
export function formatMonthShort(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  return match ? `${Number(match[2])}月` : month;
}

/** 1つ前の月。`2026-01` → `2025-12`。形が違う値は `null`。 */
export function previousMonth(month: string): string | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  const [y, mm] = m === 1 ? [year - 1, 12] : [year, m - 1];
  return `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

/**
 * 1つ後の月。`2026-12` → `2027-01`。形が違う値は `null`。繰越の確認と、締めの確認の「12月分として登録します」の、月の名前を
 * 出すためだけに使う（繰越先・登録できる月は、サーバーが決める。ここで判断に使わない）。
 */
export function nextMonth(month: string): string | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const m = Number(match[2]);
  const [y, mm] = m === 12 ? [year + 1, 1] : [year, m + 1];
  return `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

/** `2026-11-19` → `11/19(木)`。実在しない日付（`2026-02-30`）は、曜日を付けない。形が違う値は、そのまま返す。 */
export function formatExpenseDate(date: string): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) return date;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const real = utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  return real ? `${month}/${day}(${WEEKDAYS[utc.getUTCDay()]})` : `${month}/${day}`;
}
