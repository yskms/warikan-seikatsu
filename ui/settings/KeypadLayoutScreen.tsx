// キーパッドの並び（設定の「アプリの設定」。docs/screens.md 6章）。金額のキーパッドの数字の並びを、スマホ（1 2 3 が上）と電卓
// （7 8 9 が上）から選ぶ。この端末だけの設定で、サーバーには送らない（`platform/keypadLayout.ts`）。
//
// 選ぶと、すぐ反映する（保存のボタンは無い）。端末へ覚えるのに失敗しても、画面には何も出さない（この起動中は、選んだ並びのまま。
// `src/services/keypadLayoutPreference.ts`）。小さな図は、実物と同じ並びの関数（`keypadRows`）で描く。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { keypadLayoutPreference } from '../../platform/keypadLayout.ts';
import {
  KEYPAD_LAYOUTS,
  keypadLayoutDescription,
  keypadLayoutLabel,
  keypadRows,
  type KeypadLayout,
} from '../../src/services/keypadLayout.ts';
import { useColors } from '../useColors.ts';
import { useKeypadLayout } from '../useKeypadLayout.ts';

/** 並びの小さな図。読み上げには含めない（選択肢の名前と説明で足りる）。 */
function LayoutFigure({ layout }: { layout: KeypadLayout }) {
  const colors = useColors();
  return (
    <View style={styles.figure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {keypadRows(layout, 0).map((row) => (
        <View key={row[0]!.key} style={styles.figureRow}>
          {row.map((spec) => (
            <View
              key={spec.key}
              style={[
                styles.figureKey,
                { backgroundColor: spec.operator ? colors.border : colors.background, borderColor: colors.border },
              ]}
            >
              {spec.key === 'back' ? (
                <MaterialCommunityIcons name="backspace-outline" size={11} color={colors.textSecondary} />
              ) : (
                // 図の文字は、文字サイズの設定で大きくしない（キーが枠からはみ出す）
                <Text allowFontScaling={false} style={[styles.figureLabel, { color: colors.textSecondary }]}>
                  {spec.label}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function KeypadLayoutScreen() {
  const colors = useColors();
  const router = useRouter();
  const current = useKeypadLayout();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          キーパッドの並び
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          金額を入力するキーパッドの、数字の並びを選びます。この端末だけの設定で、グループやほかのメンバーには関係しません。
        </Text>
        <View accessibilityRole="radiogroup" style={styles.options}>
          {KEYPAD_LAYOUTS.map((layout) => {
            const selected = layout === current;
            return (
              <Pressable
                key={layout}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${keypadLayoutLabel(layout)}、${keypadLayoutDescription(layout)}`}
                onPress={() => void keypadLayoutPreference.choose(layout)}
                style={({ pressed }) => [
                  styles.option,
                  // 選んだ・選んでいないで、枠の太さを変えない（変えると、中の図が1dpずれる）。色だけを変える
                  { backgroundColor: colors.surface, borderColor: selected ? colors.accent : colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <LayoutFigure layout={layout} />
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{keypadLayoutLabel(layout)}</Text>
                  <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                    {keypadLayoutDescription(layout)}
                  </Text>
                </View>
                {selected ? <MaterialCommunityIcons name="check-circle" size={24} color={colors.textPrimary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 },
  note: { fontSize: 14, lineHeight: 20 },
  options: { gap: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 14, borderWidth: 2, padding: 13 },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 17, fontWeight: '600' },
  optionDescription: { fontSize: 14 },
  figure: { gap: 3 },
  figureRow: { flexDirection: 'row', gap: 3 },
  figureKey: {
    width: 24,
    height: 20,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figureLabel: { fontSize: 11, fontWeight: '500' },
  pressed: { opacity: 0.7 },
});
