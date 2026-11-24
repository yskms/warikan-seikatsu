// 設定（docs/screens.md 6章）。**いまは、アカウントのログアウトだけ**。カテゴリと負担割合・固定費・メンバーと招待・グループの設定・
// アプリの設定（キーパッドの並び）・アカウントの削除・このアプリについて（規約など）は、まだ作っていない。作るときに、ここへ足す。
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { useSignOut } from '../useSignOut.ts';

export function SettingsScreen() {
  const colors = useColors();
  const { confirmSignOut, busy, error } = useSignOut();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          設定
        </Text>
        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.textSecondary }]}>アカウント</Text>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton label="ログアウト" variant="secondary" busy={busy} onPress={confirmSignOut} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  section: { gap: 12 },
  heading: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 20 },
});
