// 金額の電卓つきキーパッド（docs/screens.md 4章）。OSのキーボードは使わない。数字、`00`（小数のある通貨では `.`）、`⌫`、`+ − × ÷`。
// 並びはスマホ（1 2 3 が上）。電卓（7 8 9 が上）の切り替えは、設定（アプリの設定）を作るときに足す。
// キーの押下の規則は `src/services/amountExpression.ts`（`npm test` で守る）。ここは、キーを並べて、押されたキーを渡すだけ。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ExpressionKey } from '../../src/services/amountExpression.ts';
import { useColors } from '../useColors.ts';

interface KeySpec {
  key: ExpressionKey;
  label: string;
  /** 読み上げ */
  spoken: string;
  operator?: boolean;
}

function layout(minorUnit: number): KeySpec[][] {
  const digit = (key: ExpressionKey): KeySpec => ({ key, label: key, spoken: key });
  const lastRow: KeySpec[] = [
    digit('0'),
    minorUnit > 0 ? { key: '.', label: '.', spoken: '小数点' } : { key: '00', label: '00', spoken: 'ゼロ2つ' },
    { key: 'back', label: '⌫', spoken: '1文字消す' },
    { key: '+', label: '+', spoken: '足す', operator: true },
  ];
  return [
    [digit('1'), digit('2'), digit('3'), { key: '/', label: '÷', spoken: '割る', operator: true }],
    [digit('4'), digit('5'), digit('6'), { key: '*', label: '×', spoken: '掛ける', operator: true }],
    [digit('7'), digit('8'), digit('9'), { key: '-', label: '−', spoken: '引く', operator: true }],
    lastRow,
  ];
}

interface AmountKeypadProps {
  minorUnit: number;
  onKey(key: ExpressionKey): void;
}

export function AmountKeypad({ minorUnit, onKey }: AmountKeypadProps) {
  const colors = useColors();
  return (
    <View style={styles.pad}>
      {layout(minorUnit).map((row) => (
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
