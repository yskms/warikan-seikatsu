// 月を1か月ずつ送って選ぶ部品（固定費の開始する月・終了する月。docs/screens.md 6章の「固定費」）。「‹  2026年11月  ›」。
// 選べる範囲（`range`）の端では、その向きの矢印を押せなくする。範囲の計算は `src/services/recurringForm.ts`。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMonth } from '../../src/services/dateFormat.ts';
import { stepMonth, type MonthRange } from '../../src/services/recurringForm.ts';
import { useColors } from '../useColors.ts';

interface MonthStepperProps {
  /** 欄の名前（読み上げ。「開始する月」など） */
  label: string;
  month: string;
  range: MonthRange;
  disabled?: boolean;
  onChange(month: string): void;
}

export function MonthStepper({ label, month, range, disabled = false, onChange }: MonthStepperProps) {
  const colors = useColors();
  const previous = stepMonth(month, -1, range);
  const next = stepMonth(month, 1, range);
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を前の月にする`}
        accessibilityState={{ disabled: disabled || previous === null }}
        disabled={disabled || previous === null}
        hitSlop={4}
        onPress={() => previous !== null && onChange(previous)}
        style={[styles.arrow, (disabled || previous === null) && styles.dimmed]}
      >
        <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
      </Pressable>
      <Text
        style={[styles.month, { color: colors.textPrimary }]}
        accessibilityRole="adjustable"
        accessibilityLabel={`${label}、${formatMonth(month)}`}
        accessibilityLiveRegion="polite"
      >
        {formatMonth(month)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}を次の月にする`}
        accessibilityState={{ disabled: disabled || next === null }}
        disabled={disabled || next === null}
        hitSlop={4}
        onPress={() => next !== null && onChange(next)}
        style={[styles.arrow, (disabled || next === null) && styles.dimmed]}
      >
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'flex-start', minWidth: 220, height: 48, borderRadius: 12, borderWidth: 1 },
  arrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 17, fontWeight: '600', paddingHorizontal: 4 },
  dimmed: { opacity: 0.35 },
});
