// 金額のキーパッドの並び（docs/screens.md 4章・6章の「アプリの設定」）。この端末だけの設定で、サーバーには保存しない。
//
// - スマホ（`phone`。初期値）: 1 2 3 が上。電卓（`calculator`）: 7 8 9 が上。**切り替わるのは、数字の3行の順だけ**。
//   演算子（右の列）・`0`・`00`（小数のある通貨では `.`）・`⌫` の位置は、どちらでも変えない（仕様）。
// - 画面（`ui/expense/AmountKeypad.tsx`）は、ここで決めた並びを描くだけ。選ぶ画面（`ui/settings/KeypadLayoutScreen.tsx`）の
//   小さな図も、同じ関数を使う（図と実物がずれない）。
import type { ExpressionKey } from './amountExpression.ts';

export type KeypadLayout = 'phone' | 'calculator';

export const DEFAULT_KEYPAD_LAYOUT: KeypadLayout = 'phone';

/** 選べる並び（選ぶ画面に出す順）。 */
export const KEYPAD_LAYOUTS: readonly KeypadLayout[] = ['phone', 'calculator'];

export function keypadLayoutLabel(layout: KeypadLayout): string {
  return layout === 'phone' ? 'スマホ' : '電卓';
}

/** 選ぶ画面の、並びの説明（上の段の数字）。 */
export function keypadLayoutDescription(layout: KeypadLayout): string {
  return layout === 'phone' ? '1 2 3 が上' : '7 8 9 が上';
}

/**
 * 端末に覚えた文字列から並びを読む。知らない値・空は `null`（呼び出し側が、初期値にする）。
 * 将来、並びを足したときに、古い版が新しい値を読んでも、初期値に戻るだけで壊れない。
 */
export function parseKeypadLayout(text: string): KeypadLayout | null {
  const value = text.trim();
  return value === 'phone' || value === 'calculator' ? value : null;
}

export interface KeySpec {
  key: ExpressionKey;
  label: string;
  /** 読み上げ */
  spoken: string;
  operator?: boolean;
}

function digit(key: ExpressionKey): KeySpec {
  return { key, label: key, spoken: key };
}

/**
 * キーの並び（4行×4列）。`minorUnit` は、通貨の小数の桁数（0なら `00`、あれば `.`）。
 * 右の列は演算子で、数字の3行の並びによらず、上から ÷ × − +。
 */
export function keypadRows(layout: KeypadLayout, minorUnit: number): KeySpec[][] {
  const digitRows: ExpressionKey[][] =
    layout === 'phone'
      ? [
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ]
      : [
          ['7', '8', '9'],
          ['4', '5', '6'],
          ['1', '2', '3'],
        ];
  const operators: KeySpec[] = [
    { key: '/', label: '÷', spoken: '割る', operator: true },
    { key: '*', label: '×', spoken: '掛ける', operator: true },
    { key: '-', label: '−', spoken: '引く', operator: true },
  ];
  const rows = digitRows.map((keys, i) => [...keys.map(digit), operators[i]!]);
  rows.push([
    digit('0'),
    minorUnit > 0 ? { key: '.', label: '.', spoken: '小数点' } : { key: '00', label: '00', spoken: 'ゼロ2つ' },
    { key: 'back', label: '⌫', spoken: '1文字消す' },
    { key: '+', label: '+', spoken: '足す', operator: true },
  ]);
  return rows;
}
