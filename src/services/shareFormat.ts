// 負担割合の表示（docs/screens.md 6章の「割合の表示」）。割合は1万分率の整数で、計算（負担額・端数の配り方）はここでしない
// （Workerだけが持つ）。ここは、受け取った割合を、文字にするだけ。
//
// - 2人で、どちらも10%単位（1000の倍数）→ 「7:3」
// - 2人で、10%単位でない → 「65% : 35%」
// - 3人以上 → 「40% / 30% / 30%」
// - 3人以上で、ほぼ均等（最大と最小の差が0.01%以内。均等にリセットした 33.34 / 33.33 / 33.33 など）→ 「均等」
// - 2人の「5:5」は、10%単位の割合なので「5:5」と出す（「均等」にしない。割合を選ぶボタンも「5:5」）
// 並びは、呼び出し側が決めた表示順（自分が先）。
import { BASIS_POINTS_TOTAL } from '../domain/categoryShare.ts';

/** 1万分率を%で。整数の%はそのまま、端数は小数第2位まで（末尾の0は落とす）。`3334` → `33.34%`、`6500` → `65%`。 */
export function formatPercent(basisPoints: number): string {
  const percent = basisPoints / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(2).replace(/0+$/, '')}%`;
}

/** 3人以上のとき、全員がほぼ同じ（最大と最小の差が1以内）で、合計が10000か。 */
function isEqualSplit(basisPoints: readonly number[]): boolean {
  if (basisPoints.length < 3) return false;
  const total = basisPoints.reduce((sum, value) => sum + value, 0);
  return total === BASIS_POINTS_TOTAL && Math.max(...basisPoints) - Math.min(...basisPoints) <= 1;
}

/** 割合の文字。`basisPoints` は表示順。 */
export function formatShareRatio(basisPoints: readonly number[]): string {
  if (basisPoints.length === 0) return '';
  if (basisPoints.length === 1) return formatPercent(basisPoints[0]!);
  if (basisPoints.length === 2) {
    const [first, second] = basisPoints as readonly [number, number];
    if (first % 1000 === 0 && second % 1000 === 0) return `${first / 1000}:${second / 1000}`;
    return `${formatPercent(first)} : ${formatPercent(second)}`;
  }
  if (isEqualSplit(basisPoints)) return '均等';
  return basisPoints.map(formatPercent).join(' / ');
}
