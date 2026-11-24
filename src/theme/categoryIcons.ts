// 費目のアイコンの一覧（docs/screens.md 6章「アイコンと色」）。キーは、サーバーが形だけを見て保存する文字列で、**公開後は
// 変えられない**（変えると、保存済みの費目のアイコンが既定の見た目に変わる）。足すのは自由。値は、`@expo/vector-icons` の
// MaterialCommunityIcons の名前（画面（RN）に依存しないよう、ここでは文字列。`ui/home/CategoryIcon.tsx` が型を付ける）。
// 絵文字は使わない（両OSで見た目をそろえるため）。初期の費目のキーは、Workerの `DEFAULT_CATEGORIES`（`worker/src/groups.ts`）。
// 色は、メンバーの色と同じ10色（`palette.ts`）。

export const CATEGORY_ICONS = {
  home: 'home',
  cart: 'cart',
  detergent: 'spray-bottle',
  bulb: 'lightbulb-outline',
  utensils: 'silverware-fork-knife',
  wifi: 'wifi',
  more: 'dots-horizontal',
  phone: 'cellphone',
  car: 'car',
  bus: 'bus',
  train: 'train',
  fuel: 'gas-station',
  water: 'water',
  fire: 'fire',
  tv: 'television',
  shirt: 'tshirt-crew',
  gift: 'gift',
  pet: 'paw',
  baby: 'baby-face-outline',
  book: 'book-open-variant',
  game: 'gamepad-variant',
  plane: 'airplane',
  tools: 'wrench',
  heart: 'heart',
  coffee: 'coffee',
  scissors: 'content-cut',
  bed: 'bed',
  sofa: 'sofa',
  pill: 'pill',
  medical: 'medical-bag',
} as const satisfies Record<string, string>;

export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

/** 選べるアイコンのキー（表示の並び）。 */
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS) as CategoryIconKey[];

/** 知らないキー（サーバーが形だけを見るので来うる）の見た目 */
export const FALLBACK_ICON_NAME = 'shape-outline';

/** キーから、アイコンの名前へ。知らないキーは既定のアイコン。 */
export function categoryIconGlyph(key: string): string {
  // 自分のキーだけを引く（`toString` のような継承されたプロパティ名で、名前以外の値を返さない）
  return Object.hasOwn(CATEGORY_ICONS, key) ? (CATEGORY_ICONS as Record<string, string>)[key]! : FALLBACK_ICON_NAME;
}
