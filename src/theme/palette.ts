// メンバー・費目の色（キーから実際の色へ）。キーは、サーバーが持つ一覧（`MEMBER_COLORS`。docs/backend-design.md 9章）。
// サーバーは費目の色を形しか見ない（知らないキーが来うる）ので、知らないキーは `gray` にする。
// 色は、塗りの上に濃い文字（`paletteText`）を置く前提で、ライト・ダークで共通（`palette.test.ts` が、文字とのコントラストを
// AA（4.5:1）で確かめる）。

export const palette = {
  pink: '#FC75A4',
  red: '#F4837D',
  orange: '#FFA94D',
  yellow: '#FFD43B',
  green: '#69DB7C',
  teal: '#38D9A9',
  blue: '#74C0FC',
  purple: '#B197FC',
  brown: '#C69C6D',
  gray: '#ADB5BD',
} as const;

/** 色の塗りの上に置く文字 */
export const paletteText = '#17171A';

/** キーから色へ。知らないキーは `gray`。 */
export function paletteColor(key: string): string {
  // 自分のキーだけを引く（`toString` のような継承されたプロパティ名で、色以外の値を返さない）
  return Object.hasOwn(palette, key) ? (palette as Record<string, string>)[key]! : palette.gray;
}
