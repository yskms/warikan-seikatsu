// 金額の電卓つきキーパッド（docs/screens.md 4章）。OSのキーボードは使わない。数字、`00`（小数のある通貨では `.`）、`⌫`、`+ − × ÷`。
// 数字の並び（スマホ: 1 2 3 が上 / 電卓: 7 8 9 が上）は、アプリの設定（`src/services/keypadLayout.ts`）。演算子・`00`・`⌫` の位置は変えない。
// キーの押下の規則は `src/services/amountExpression.ts`（`npm test` で守る）。ここは、キーを並べて、押されたキーを渡すだけ。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ExpressionKey } from '../../src/services/amountExpression.ts';
import { keypadRows } from '../../src/services/keypadLayout.ts';
import { useColors } from '../useColors.ts';
import { useKeypadLayout } from '../useKeypadLayout.ts';

interface AmountKeypadProps {
  minorUnit: number;
  onKey(key: ExpressionKey): void;
}

export function AmountKeypad({ minorUnit, onKey }: AmountKeypadProps) {
  const colors = useColors();
  const layout = useKeypadLayout();
  return (
    <View style={styles.pad}>
      {keypadRows(layout, minorUnit).map((row) => (
        <View key={row[0]!.key} style={styles.row}>
          {row.map((spec) => (
            <Pressable
              key={spec.key}
              accessibilityRole="button"
              accessibilityLabel={spec.spoken}
              onPress={() => onKey(spec.key)}
              style={({ pressed }) => [
                styles.key,
                { backgroundColor: spec.operator ? colors.border : colors.surface, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              {spec.key === 'back' ? (
                <MaterialCommunityIcons name="backspace-outline" size={22} color={colors.textPrimary} />
              ) : (
                <Text style={[styles.label, { color: colors.textPrimary }]}>{spec.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  key: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 22, fontWeight: '500' },
  pressed: { opacity: 0.6 },
});
