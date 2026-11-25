// 設定（docs/screens.md 6章）。いま作ってあるのは、「このグループ」の「カテゴリと負担割合」・「固定費」・「メンバーと招待」・
// 「グループの設定」と、「アプリの設定」のキーパッドの並び、「アカウント」のログアウト・アカウントを削除。このアプリについて（規約など）は、
// まだ作っていない。作るときに、ここへ足す。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { keypadLayoutLabel } from '../../src/services/keypadLayout.ts';
import { useCurrentGroup } from '../CurrentGroup.tsx';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { useKeypadLayout } from '../useKeypadLayout.ts';
import { useSignOut } from '../useSignOut.ts';

export function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const group = useCurrentGroup();
  const { confirmSignOut, busy, error } = useSignOut();
  const keypadLayout = keypadLayoutLabel(useKeypadLayout());
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          設定
        </Text>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.textSecondary }]} accessibilityRole="header">
            このグループ
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="カテゴリと負担割合"
            onPress={() => router.push({ pathname: '/categories', params: { groupId: group.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>カテゴリと負担割合</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="固定費"
            onPress={() => router.push({ pathname: '/recurring', params: { groupId: group.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>固定費</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="メンバーと招待"
            onPress={() => router.push({ pathname: '/members', params: { groupId: group.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>メンバーと招待</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="グループの設定"
            onPress={() => router.push({ pathname: '/group-settings', params: { groupId: group.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>グループの設定</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.textSecondary }]} accessibilityRole="header">
            アプリの設定（この端末だけ）
          </Text>
          {/* 現在の並びを、行の右に出す（選ぶ画面は、2つの並びの小さな図つき） */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`キーパッドの並び、${keypadLayout}`}
            onPress={() => router.push('/keypad-layout')}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>キーパッドの並び</Text>
            <View style={styles.rowValue}>
              <Text style={[styles.rowValueText, { color: colors.textSecondary }]}>{keypadLayout}</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
            </View>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.textSecondary }]} accessibilityRole="header">
            アカウント
          </Text>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton label="ログアウト" variant="secondary" busy={busy} onPress={confirmSignOut} />
          {/* 削除の画面で、説明を読んでから、本人確認を経て削除する。ログアウトの最中は、押せない（セッションを捨てる最中に、
              削除の手順を始めない） */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="アカウントを削除"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => router.push('/delete-account')}
            style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, busy && styles.dimmed, pressed && styles.pressed]}
          >
            <Text style={[styles.rowLabel, { color: colors.error }]}>アカウントを削除</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  section: { gap: 12 },
  heading: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 16, fontWeight: '600' },
  rowValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowValueText: { fontSize: 15 },
  error: { fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.5 },
});
