// 選択肢の並び（カテゴリ・支払った人・登録する月・負担の方法）。1つだけ選ぶ（`radiogroup`）。横にあふれたら、横スクロール。
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../useColors.ts';

export interface ChipOption {
  key: string;
  /** 読み上げと、既定の表示 */
  label: string;
  /** ラベルの前に出す飾り（アイコンなど） */
  leading?: ReactNode;
  /** 補足（読み上げにだけ足す。「脱退」など） */
  note?: string;
}

interface ChipsProps {
  options: ChipOption[];
  /** 選んでいるキー。複数選べる使い方（`multiple`）では、選んでいるキーのすべて */
  selected: string | readonly string[] | null;
  onSelect(key: string): void;
  /** 横スクロールにせず、折り返す（選択肢が少ないとき） */
  wrap?: boolean;
  /** 複数選べる（均等割りの、負担に入れるメンバー）。読み上げの役割を、チェックボックスにする */
  multiple?: boolean;
  disabled?: boolean;
}

export function Chips({ options, selected, onSelect, wrap = false, multiple = false, disabled = false }: ChipsProps) {
  const colors = useColors();
  const isSelected = (key: string) => (Array.isArray(selected) ? selected.includes(key) : selected === key);
  const chips = options.map((option) => {
    const on = isSelected(option.key);
    return (
      <Pressable
        key={option.key}
        accessibilityRole={multiple ? 'checkbox' : 'radio'}
        accessibilityLabel={option.note ? `${option.label}、${option.note}` : option.label}
        accessibilityState={{ selected: multiple ? undefined : on, checked: multiple ? on : undefined, disabled }}
        disabled={disabled}
        onPress={() => onSelect(option.key)}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: on ? colors.accent : colors.surface,
            borderColor: on ? colors.accent : colors.border,
          },
          pressed && styles.pressed,
          disabled && styles.dimmed,
        ]}
      >
        {option.leading}
        <Text style={[styles.label, { color: on ? colors.onAccent : colors.textPrimary }]} numberOfLines={1}>
          {option.label}
        </Text>
      </Pressable>
    );
  });
  if (wrap) {
    return (
      <View style={styles.wrap} accessibilityRole={multiple ? undefined : 'radiogroup'}>
        {chips}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scroll}
      accessibilityRole={multiple ? undefined : 'radiogroup'}
    >
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: 8, paddingRight: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 220,
  },
  label: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.5 },
});
