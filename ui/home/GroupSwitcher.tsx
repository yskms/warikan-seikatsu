// ホームの上部のグループ名と、グループの切り替え（docs/screens.md 1章）。複数のグループに入っている人は、グループ名をタップして、
// 下から出る一覧（月のピッカー `MonthHeader.tsx` と同じ作り）から選ぶ。**グループが1つの人には、切り替えの操作を見せない**
// （グループ名を、ただの見出しとして出す）。
// 選ぶと、一覧を閉じてから `onSelect` を呼ぶ（`GroupGate` が、画面ごと作り直す）。選んだのがいまのグループなら、何もしない。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { GroupOption } from '../CurrentGroup.tsx';
import { useColors } from '../useColors.ts';

interface GroupSwitcherProps {
  /** いまのグループの名前（ホームが読み直した最新の名前があれば、それ） */
  name: string;
  currentId: string;
  groups: readonly GroupOption[];
  onSelect(groupId: string): void;
}

export function GroupSwitcher({ name, currentId, groups, onSelect }: GroupSwitcherProps) {
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (groups.length <= 1) {
    return (
      <Text style={[styles.name, { color: colors.textSecondary }]} accessibilityRole="header" numberOfLines={1}>
        {name}
      </Text>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}。グループを切り替える`}
        hitSlop={8}
        onPress={() => setPickerOpen(true)}
        style={styles.button}
      >
        <Text style={[styles.name, styles.buttonName, { color: colors.textSecondary }]} numberOfLines={1}>
          {name}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={colors.textSecondary} />
      </Pressable>

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
              グループを選ぶ
            </Text>
            <ScrollView style={styles.list}>
              {groups.map((group) => {
                const selected = group.id === currentId;
                return (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityLabel={group.name}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setPickerOpen(false);
                      if (!selected) onSelect(group.id);
                    }}
                    style={[styles.option, { borderColor: colors.border }]}
                  >
                    <Text
                      style={[styles.optionLabel, { color: colors.textPrimary }, selected && styles.selected]}
                      numberOfLines={1}
                    >
                      {group.name}
                    </Text>
                    {selected ? (
                      <MaterialCommunityIcons name="check" size={20} color={colors.textPrimary} />
                    ) : (
                      <View style={styles.checkSpace} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  row: { alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, maxWidth: '100%' },
  // 長い名前は、矢印を押し出さず、名前のほうを省略する
  buttonName: { flexShrink: 1 },
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
  checkSpace: { width: 20 },
});
