// 費目のアイコン（費目の色で塗った丸の中に、アイコン）。アイコンのキーは、サーバーが形だけを見る（知らないキーが来うる）ので、
// 知らないキーは既定のアイコンにする。キーの一覧は `src/theme/categoryIcons.ts`（初期の費目のキーは、Workerの
// `DEFAULT_CATEGORIES`（`worker/src/groups.ts`））。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { categoryIconGlyph } from '../../src/theme/categoryIcons.ts';
import { paletteColor, paletteText } from '../../src/theme/palette.ts';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** キーから、アイコンの名前へ。知らないキーは既定のアイコン（一覧は `src/theme/categoryIcons.ts`）。 */
export function categoryIconName(key: string): IconName {
  return categoryIconGlyph(key) as IconName;
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
