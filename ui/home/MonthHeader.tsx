// 月の切り替え（docs/screens.md 3章）。「◀ 2026年11月 ⌄ ▶」。矢印で前後の月へ、月の表示をタップすると月のピッカーを開く。
// 選べる月は、サーバーの一覧（`GET /groups/:id/months`）をそのまま使う（アプリで計算しない）。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatMonth } from '../../src/services/dateFormat.ts';
import type { MonthOption } from '../../src/services/homeView.ts';
import { useColors } from '../useColors.ts';

interface MonthHeaderProps {
  month: string;
  previous: string | null;
  next: string | null;
  options: MonthOption[];
  onSelect(month: string): void;
}

export function MonthHeader({ month, previous, next, options, onSelect }: MonthHeaderProps) {
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.row}>
      <ArrowButton direction="previous" target={previous} onSelect={onSelect} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatMonth(month)}。月を選ぶ`}
        hitSlop={8}
        onPress={() => setPickerOpen(true)}
        style={styles.monthButton}
      >
        <Text style={[styles.month, { color: colors.textPrimary }]}>{formatMonth(month)}</Text>
        <MaterialCommunityIcons name="chevron-down" size={22} color={colors.textSecondary} />
      </Pressable>
      <ArrowButton direction="next" target={next} onSelect={onSelect} />

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          {/* 外側をタップしたら閉じる */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            style={StyleSheet.absoluteFill}
            onPress={() => setPickerOpen(false)}
          />
          <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.background }]}>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]} accessibilityRole="header">
              月を選ぶ
            </Text>
            <ScrollView style={styles.list}>
              {options.map((option) => (
                <Pressable
                  key={option.month}
                  accessibilityRole="button"
                  accessibilityLabel={option.statusLabel ? `${option.label}、${option.statusLabel}` : option.label}
                  accessibilityState={{ selected: option.selected }}
                  onPress={() => {
                    setPickerOpen(false);
                    if (!option.selected) onSelect(option.month);
                  }}
                  style={[styles.option, { borderColor: colors.border }]}
                >
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }, option.selected && styles.selected]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.optionStatus, { color: colors.textSecondary }]}>{option.statusLabel}</Text>
                  {option.selected ? (
                    <MaterialCommunityIcons name="check" size={20} color={colors.textPrimary} />
                  ) : (
                    <View style={styles.checkSpace} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function ArrowButton({
  direction,
  target,
  onSelect,
}: {
  direction: 'previous' | 'next';
  target: string | null;
  onSelect(month: string): void;
}) {
  const colors = useColors();
  const disabled = target === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === 'previous' ? '前の月' : '次の月'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => target !== null && onSelect(target)}
      style={[styles.arrow, disabled && styles.dimmed]}
    >
      <MaterialCommunityIcons
        name={direction === 'previous' ? 'chevron-left' : 'chevron-right'}
        size={30}
        color={colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  monthButton: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  month: { fontSize: 20, fontWeight: '700' },
  dimmed: { opacity: 0.3 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 20 },
  sheetTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  list: { flexGrow: 0 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: { flex: 1, fontSize: 17 },
  selected: { fontWeight: '700' },
  optionStatus: { fontSize: 13 },
  checkSpace: { width: 20 },
});
