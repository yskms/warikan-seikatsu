// 金額の表示。金額は通貨の最小単位の整数（docs/backend-design.md 2章）で、浮動小数点にしない。小数桁数はグループが持つ
// （`currencyMinorUnit`。アプリが通貨コードから決め直さない）。表示の形だけをここで決める（記号と、3桁区切り）。

/** 通貨の記号（`CURRENCIES`。docs/backend-design.md 2章）。知らない通貨は、コードを前に付ける。 */
const SYMBOLS: Record<string, string> = {
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  CNY: 'CN¥',
  KRW: '₩',
};

/** 正の整数を3桁ごとに区切る。 */
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 金額の表示（`¥128,450`、`$12.34`）。負の金額は先頭に `-`。安全整数でない値は、丸めずに `-` にする
 * （壊れた値を、もっともらしい金額に見せない）。
 */
export function formatMoney(amountMinor: number, currencyCode: string, minorUnit: number): string {
  if (!Number.isSafeInteger(amountMinor) || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) return '-';
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const unit = 10 ** minorUnit;
  let text = groupDigits(Math.floor(abs / unit));
  if (minorUnit > 0) text += `.${String(abs % unit).padStart(minorUnit, '0')}`;
  // 自分のキーだけを引く（`toString` のような継承されたプロパティ名で、記号以外の値を返さない）
  const symbol = Object.hasOwn(SYMBOLS, currencyCode) ? SYMBOLS[currencyCode] : undefined;
  return `${sign}${symbol ?? `${currencyCode} `}${text}`;
}

/** 差額など、向きを見せたい金額（`+¥3,000`、`-¥3,000`。0は符号なし）。 */
export function formatSignedMoney(amountMinor: number, currencyCode: string, minorUnit: number): string {
  const text = formatMoney(amountMinor, currencyCode, minorUnit);
  return amountMinor > 0 ? `+${text}` : text;
}
