// 費目のアイコン（費目の色で塗った丸の中に、アイコン）。アイコンのキーは、サーバーが形だけを見る（知らないキーが来うる）ので、
// 知らないキーは既定のアイコンにする。初期の費目のキーは、Workerの `DEFAULT_CATEGORIES`（`worker/src/groups.ts`）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { paletteColor, paletteText } from '../../src/theme/palette.ts';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Record<string, IconName> = {
  home: 'home',
  cart: 'cart',
  detergent: 'spray-bottle',
  bulb: 'lightbulb-outline',
  utensils: 'silverware-fork-knife',
  wifi: 'wifi',
  more: 'dots-horizontal',
};

const FALLBACK_ICON: IconName = 'shape-outline';

export function categoryIconName(key: string): IconName {
  return Object.hasOwn(ICONS, key) ? ICONS[key]! : FALLBACK_ICON;
}

interface CategoryIconProps {
  icon: string;
  color: string;
  size?: number;
}

export function CategoryIcon({ icon, color, size = 40 }: CategoryIconProps) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: paletteColor(color) }]}
    >
      <MaterialCommunityIcons name={categoryIconName(icon)} size={size * 0.55} color={paletteText} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
