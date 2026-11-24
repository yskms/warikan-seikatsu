// 金額の表示（式と結果）。タップすると、キーパッドがこの欄に向く（画面の側で `onPress` に渡す）。
// 式を入れたときは、「1,200+800」の下に「= ¥2,000」を出す。結果が保存できない金額のときは、結果を出さない（理由は、画面の下）。
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { amountState, formatExpression } from '../../src/services/amountExpression.ts';
import { currencySymbol, formatMoney } from '../../src/services/money.ts';
import { useColors } from '../useColors.ts';

interface AmountFieldProps {
  /** 金額の式 */
  expression: string;
  currencyCode: string;
  minorUnit: number;
  /** キーパッドが、この欄に向いているか */
  active: boolean;
  /** タップで、キーパッドをこの欄に向ける。無ければ、読み取り専用 */
  onPress?(): void;
  /** 欄の名前（読み上げ。「金額」「あなたの負担額」など） */
  label: string;
  /** 小さく出す（金額指定の、メンバーごとの欄） */
  compact?: boolean;
  /** 式が空のとき */
  placeholder?: string;
}

export function AmountField({
  expression,
  currencyCode,
  minorUnit,
  active,
  onPress,
  label,
  compact = false,
  placeholder = '0',
}: AmountFieldProps) {
  const colors = useColors();
  const state = amountState(expression, minorUnit);
  const shown = expression === '' ? placeholder : formatExpression(expression);
  const result =
    state.kind === 'ok' && state.calculation ? `= ${formatMoney(state.minor, currencyCode, minorUnit)}` : null;
  const spoken =
    expression === ''
      ? `${label}、未入力`
      : `${label}、${state.kind === 'ok' ? formatMoney(state.minor, currencyCode, minorUnit) : formatExpression(expression)}`;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={spoken}
      accessibilityHint={onPress ? '押すと、金額のキーパッドを出します' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.field,
        compact && styles.compact,
        { backgroundColor: colors.surface, borderColor: active ? colors.accent : colors.border, borderWidth: active ? 2 : 1 },
      ]}
    >
      <View style={styles.line}>
        <Text style={[compact ? styles.symbolSmall : styles.symbol, { color: colors.textSecondary }]}>
          {currencySymbol(currencyCode)}
        </Text>
        <Text
          style={[
            compact ? styles.amountSmall : styles.amount,
            { color: expression === '' ? colors.textSecondary : colors.textPrimary },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {shown}
        </Text>
      </View>
      {result !== null ? <Text style={[styles.result, { color: colors.textSecondary }]}>{result}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, gap: 2, alignItems: 'flex-end' },
  compact: { paddingVertical: 8, minWidth: 120 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 4, alignSelf: 'stretch', justifyContent: 'flex-end' },
  symbol: { fontSize: 24, fontWeight: '600' },
  amount: { fontSize: 40, fontWeight: '700', flexShrink: 1 },
  symbolSmall: { fontSize: 15, fontWeight: '600' },
  amountSmall: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  result: { fontSize: 15, fontWeight: '600' },
});
