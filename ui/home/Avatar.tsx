// メンバーのアイコン（名前の頭文字を、メンバーの色で塗った丸）。色は、塗りの上の濃い文字でAAを満たす（`src/theme/palette.ts`）。
import { StyleSheet, Text, View } from 'react-native';

import { paletteColor, paletteText } from '../../src/theme/palette.ts';

interface AvatarProps {
  initial: string;
  /** 色のキー（知らないキーは灰色） */
  color: string;
  size?: number;
}

export function Avatar({ initial, color, size = 36 }: AvatarProps) {
  return (
    // 頭文字は、隣の名前と同じ内容なので、読み上げの対象にしない
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: paletteColor(color) }]}
    >
      <Text style={[styles.initial, { color: paletteText, fontSize: size * 0.44 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
});
