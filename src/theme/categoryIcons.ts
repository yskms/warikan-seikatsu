// 費目のアイコンの一覧（docs/screens.md 6章「アイコンと色」）。キーは、サーバーが形だけを見て保存する文字列で、**公開後は
// 変えられない**（変えると、保存済みの費目のアイコンが既定の見た目に変わる）。足すのは自由。`glyph` は、`@expo/vector-icons` の
// MaterialCommunityIcons の名前（画面（RN）に依存しないよう、ここでは文字列。`ui/home/CategoryIcon.tsx` が型を付ける）。
// `label` は、選ぶ画面の読み上げ用。絵文字は使わない（両OSで見た目をそろえるため）。初期の費目のキーは、Workerの
// `DEFAULT_CATEGORIES`（`worker/src/groups.ts`）。色は、メンバーの色と同じ10色（`palette.ts`）。

export const CATEGORY_ICONS = {
  home: { glyph: 'home', label: '家' },
  cart: { glyph: 'cart', label: 'カート' },
  detergent: { glyph: 'spray-bottle', label: '洗剤' },
  bulb: { glyph: 'lightbulb-outline', label: '電球' },
  utensils: { glyph: 'silverware-fork-knife', label: '食器' },
  wifi: { glyph: 'wifi', label: 'Wi-Fi' },
  more: { glyph: 'dots-horizontal', label: 'その他' },
  phone: { glyph: 'cellphone', label: '携帯電話' },
  car: { glyph: 'car', label: '車' },
  bus: { glyph: 'bus', label: 'バス' },
  train: { glyph: 'train', label: '電車' },
  fuel: { glyph: 'gas-station', label: 'ガソリン' },
  water: { glyph: 'water', label: '水' },
  fire: { glyph: 'fire', label: '火' },
  tv: { glyph: 'television', label: 'テレビ' },
  shirt: { glyph: 'tshirt-crew', label: '服' },
  gift: { glyph: 'gift', label: 'プレゼント' },
  pet: { glyph: 'paw', label: 'ペット' },
  baby: { glyph: 'baby-face-outline', label: '子ども' },
  book: { glyph: 'book-open-variant', label: '本' },
  game: { glyph: 'gamepad-variant', label: 'ゲーム' },
  plane: { glyph: 'airplane', label: '飛行機' },
  tools: { glyph: 'wrench', label: '工具' },
  heart: { glyph: 'heart', label: 'ハート' },
  coffee: { glyph: 'coffee', label: 'コーヒー' },
  scissors: { glyph: 'content-cut', label: 'はさみ' },
  bed: { glyph: 'bed', label: 'ベッド' },
  sofa: { glyph: 'sofa', label: 'ソファ' },
  pill: { glyph: 'pill', label: '薬' },
  medical: { glyph: 'medical-bag', label: '医療' },
} as const satisfies Record<string, { glyph: string; label: string }>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

/** 選べるアイコンのキー（表示の並び）。 */
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

/** 知らないキー（サーバーが形だけを見るので来うる）の見た目 */
export const FALLBACK_ICON_NAME = 'shape-outline';

/** キーから、アイコンの名前へ。知らないキーは既定のアイコン。 */
export function categoryIconGlyph(key: string): string {
  // 自分のキーだけを引く（`toString` のような継承されたプロパティ名で、名前以外の値を返さない）
  return Object.hasOwn(CATEGORY_ICONS, key) ? (CATEGORY_ICONS as Record<string, { glyph: string }>)[key]!.glyph : FALLBACK_ICON_NAME;
}

/** キーから、読み上げ用の名前へ。知らないキーは「アイコン」。 */
export function categoryIconLabel(key: string): string {
  return Object.hasOwn(CATEGORY_ICONS, key) ? (CATEGORY_ICONS as Record<string, { label: string }>)[key]!.label : 'アイコン';
}

/** 色のキーの、読み上げ用の名前（`palette.ts` の10色）。知らないキーは「色」。 */
const COLOR_LABELS: Record<string, string> = {
  pink: 'ピンク',
  red: '赤',
  orange: 'オレンジ',
  yellow: '黄',
  green: '緑',
  teal: '青緑',
  blue: '青',
  purple: '紫',
  brown: '茶',
  gray: '灰',
};

export function categoryColorLabel(key: string): string {
  return Object.hasOwn(COLOR_LABELS, key) ? COLOR_LABELS[key]! : '色';
}
