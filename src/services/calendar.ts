// 日付・月の計算（支出の日付の選択に使う。`YYYY-MM`・`YYYY-MM-DD`）。画面（RN）には依存しない（`npm test` で守る）。
// どの月を登録できるかは、サーバーが返す月の一覧を使い、ここでは計算しない（ここは、カレンダーを描く計算だけ）。

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pad2 = (value: number) => String(value).padStart(2, '0');

/** 実在する日付か（`2026-02-30` は偽） */
export function isRealDate(date: string): boolean {
  const match = DATE_PATTERN.exec(date);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** 日付の月（`2026-11-19` → `2026-11`）。形が違う値は `null`。 */
export function monthOfDate(date: string): string | null {
  return DATE_PATTERN.test(date) ? date.slice(0, 7) : null;
}

/** 月の通し番号（年 × 12 + 月 - 1）。月どうしの距離を測るため。形が違う値は `null`。 */
export function monthIndex(month: string): number | null {
  const match = MONTH_PATTERN.exec(month);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

/** 月を `delta` か月ずらす（負で前）。形が違う値は `null`。 */
export function shiftMonth(month: string, delta: number): string | null {
  const index = monthIndex(month);
  if (index === null) return null;
  const shifted = index + delta;
  if (shifted < 0) return null;
  return `${String(Math.floor(shifted / 12)).padStart(4, '0')}-${pad2((shifted % 12) + 1)}`;
}

/** その月の日数。形が違う値は `null`。 */
export function daysInMonth(month: string): number | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}

/** 月と日から日付を作る。その月に無い日は `null`。 */
export function dateOf(month: string, day: number): string | null {
  const days = daysInMonth(month);
  return days !== null && Number.isInteger(day) && day >= 1 && day <= days ? `${month}-${pad2(day)}` : null;
}

/**
 * カレンダーの週の並び（日曜始まり）。各週は7つで、月の外のマスは `null`。形が違う月は空。
 * 例: 2026-11 は日曜が1日なので、最初の週は `[1, 2, 3, 4, 5, 6, 7]`。
 */
export function monthGrid(month: string): (number | null)[][] {
  const days = daysInMonth(month);
  if (days === null) return [];
  const first = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).getUTCDay();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/**
 * 指定のタイムゾーンでの「今日」（`YYYY-MM-DD`）。月の境目はグループのタイムゾーンで決まる（サーバーの `currentMonth`）ので、
 * 日付の既定値もそれに合わせる。タイムゾーン名を使えないときは、端末の日付にする。
 */
export function todayIn(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value;
    const [year, month, day] = [pick('year'), pick('month'), pick('day')];
    if (year !== undefined && month !== undefined && day !== undefined) {
      const date = `${year.padStart(4, '0')}-${month}-${day}`;
      if (isRealDate(date)) return date;
    }
  } catch {
    // 知らないタイムゾーン名など。端末の日付にする
  }
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
