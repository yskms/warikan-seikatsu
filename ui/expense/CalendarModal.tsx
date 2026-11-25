// 日付の選択（カレンダー）。登録する月とは関係なく、どの日でも選べる（docs/screens.md 4章）。月の計算は
// `src/services/calendar.ts`（`npm test` で守る）。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dateOf, monthGrid, monthOfDate, shiftMonth } from '../../src/services/calendar.ts';
import { formatMonth } from '../../src/services/dateFormat.ts';
import { useColors } from '../useColors.ts';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface CalendarModalProps {
  visible: boolean;
  /** 選んでいる日付（`YYYY-MM-DD`） */
  value: string;
  /** 今日（`YYYY-MM-DD`）。目印を付ける */
  today: string;
  onSelect(date: string): void;
  onClose(): void;
}

export function CalendarModal({ visible, value, today, onSelect, onClose }: CalendarModalProps) {
  const colors = useColors();
  // 開くたびに、選んでいる日付の月から始める（閉じたあとの月の移動は引き継がない）
  const [shown, setShown] = useState<string | null>(null);
  const month = shown ?? monthOfDate(value) ?? monthOfDate(today) ?? '2026-01';
  const grid = monthGrid(month);
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  function close() {
    setShown(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" style={StyleSheet.absoluteFill} onPress={close} />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="前の月"
              disabled={previous === null}
              hitSlop={8}
              onPress={() => previous !== null && setShown(previous)}
              style={styles.arrow}
            >
              <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
            </Pressable>
            <Text style={[styles.month, { color: colors.textPrimary }]} accessibilityRole="header">
              {formatMonth(month)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="次の月"
              disabled={next === null}
              hitSlop={8}
              onPress={() => next !== null && setShown(next)}
              style={styles.arrow}
            >
              <MaterialCommunityIcons name="chevron-right" size={28} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.week}>
            {WEEKDAYS.map((weekday) => (
              <Text key={weekday} style={[styles.weekday, { color: colors.textSecondary }]} importantForAccessibility="no">
                {weekday}
              </Text>
            ))}
          </View>
          {grid.map((week, weekIndex) => (
            <View key={`${month}-${weekIndex}`} style={styles.week}>
              {week.map((day, index) => {
                if (day === null) return <View key={`blank-${index}`} style={styles.cell} />;
                const date = dateOf(month, day);
                const selected = date === value;
                const isToday = date === today;
                return (
                  <Pressable
                    key={day}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatMonth(month)}${day}日${isToday ? '、今日' : ''}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      if (date !== null) onSelect(date);
                      close();
                    }}
                    style={[
                      styles.cell,
                      selected && { backgroundColor: colors.accent },
                      !selected && isToday && { borderColor: colors.accent, borderWidth: 2 },
                    ]}
                  >
                    <Text style={[styles.day, { color: selected ? colors.onAccent : colors.textPrimary }]}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 18, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 13, paddingVertical: 4 },
  cell: { flex: 1, aspectRatio: 1, margin: 2, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  day: { fontSize: 16, fontWeight: '500' },
});
