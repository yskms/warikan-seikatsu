// 色の定数。画面・部品に直書きせず、ここに集約する（見た目の方針は docs/screens.md の冒頭）。
// アクセントは、旧アイコンの色（#FC75A4）。アイコンを赤（#C8000C）に変えたので、アクセントをアイコンに合わせるかは未定
// （決めたらここの `accent` を直す）。
//
// `accent`（ピンク）は、白の上で約2.6:1しかなく、小さな文字の色には足りない。塗り・アイコン・大きな装飾として使い、
// ピンクの面の上の文字は `onAccent`（濃い色）にする（`colors.test.ts` が確認する）。

export const accent = '#FC75A4';

export interface ThemeColors {
  /** 画面の背景 */
  background: string;
  /** 背景から一段浮いた面（ボタンなど） */
  surface: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  /** アクセント（ピンク）。塗り・アイコン・装飾に使う。文字の色にはしない */
  accent: string;
  /** accent の面の上の文字 */
  onAccent: string;
  /** エラーの文字。background・surface の上でAA（4.5:1）を満たす */
  error: string;
}

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F7F7F8',
  border: '#E4E4E7',
  textPrimary: '#17171A',
  textSecondary: '#6B6B76',
  accent,
  onAccent: '#17171A',
  error: '#B3261E',
};

export const darkColors: ThemeColors = {
  background: '#101012',
  surface: '#1C1C1F',
  border: '#3A3A40',
  textPrimary: '#F4F4F5',
  textSecondary: '#A1A1AA',
  accent,
  onAccent: '#17171A',
  error: '#F2B8B5',
};

export const colorsByScheme = { light: lightColors, dark: darkColors } as const;
