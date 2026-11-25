// ホームの上部のグループ名と、グループの切り替え（docs/screens.md 1章）。複数のグループに入っている人は、グループ名をタップして、
// 下から出る一覧（月のピッカー `MonthHeader.tsx` と同じ作り）から選ぶ。**グループが1つの人には、切り替えの操作を見せない**
// （グループ名を、ただの見出しとして出す）。
// 選ぶと、一覧を閉じる指示と `onSelect` を、**同時に**行う（`GroupGate` が、ホームごと作り直す）ので、`Modal` は、表示中のまま外れる
// （閉じるアニメーションは走らない）。RN 0.86 のiOSは、`Modal` が外れたとき、表示中のモーダルを閉じる処理を持つ
// （`RCTModalHostViewComponentView.mm` の `ensurePresentedOnlyIfNeeded`。`superview` から外れると閉じる）。Androidは、エミュレータで
// 確かめた。iOSは未確認。選んだのがいまのグループなら、何もしない。
//
// **`disabled` のあいだは、押せない**: 切り替えるとホームごと外れるので、書き込みの通信の最中（ホームの精算完了・繰越。
// `ui/home/useTransferActions.ts`）に押せると、結果（成功・失敗の文言・読み直し）を受ける画面が無くなる。繰越は取り消せないので、
// 済んだか分からないまま別のグループへ移ってしまう。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
  /** 切り替えを押せなくする（書き込みの通信の最中）。グループが1つのときは、もともと押せない */
  disabled?: boolean;
}

export function GroupSwitcher({ name, currentId, groups, onSelect, disabled = false }: GroupSwitcherProps) {
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
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={() => setPickerOpen(true)}
        style={[styles.button, disabled && styles.dimmed]}
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
  dimmed: { opacity: 0.4 },
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
