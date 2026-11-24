// 毎月の日（1〜31）を選ぶ格子（固定費のシート。docs/screens.md 6章の「固定費」）。7列。選んだ日をアクセントで塗る。
// その月に無い日（29〜31日）は、月末日に登録される（サーバーの規則。説明は画面の側で添える）。
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DAYS_OF_MONTH } from '../../src/services/recurringForm.ts';
import { useColors } from '../useColors.ts';

interface DayOfMonthGridProps {
  /** 選んでいる日。選んでいなければ `null` */
  value: number | null;
  disabled?: boolean;
  onSelect(day: number): void;
}

export function DayOfMonthGrid({ value, disabled = false, onSelect }: DayOfMonthGridProps) {
  const colors = useColors();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="毎月の日">
      {DAYS_OF_MONTH.map((day) => {
        const on = value === day;
        return (
          <View key={day} style={styles.cell}>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={`${day}日`}
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled}
              onPress={() => onSelect(day)}
              style={({ pressed }) => [
                styles.day,
                {
                  backgroundColor: on ? colors.accent : colors.surface,
                  borderColor: on ? colors.accent : colors.border,
                },
                pressed && styles.pressed,
                disabled && styles.dimmed,
              ]}
            >
              <Text style={[styles.label, { color: on ? colors.onAccent : colors.textPrimary }]}>{day}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 7列（100% / 7）。押す部分は44以上を保つ
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
});
