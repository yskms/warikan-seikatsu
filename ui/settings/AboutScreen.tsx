// このアプリについて（設定の最後の行。docs/screens.md 6章）。プライバシーポリシー・利用規約・お問い合わせのページへのリンクと、
// アプリの版を出す。
//
// リンクは、外のブラウザで開く（ログイン画面と同じ。`app/login.tsx`）。**公開していないページ（仮の値）の行は出さない**
// （`src/services/aboutView.ts`）。開けなかったときは、画面に出す（押しても何も起きないと、壊れて見える）。
// ライセンス（使っているオープンソースの一覧）は、まだ作っていない（docs/screens.md 6章）。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { readAppVersion } from '../../platform/appVersion.ts';
import { CONTACT_URL, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../src/legal/legalUrls.ts';
import { buildAboutLinks, versionLabel } from '../../src/services/aboutView.ts';
import { useColors } from '../useColors.ts';

const OPEN_FAILED = 'ページを開けませんでした。ブラウザが使えるか確かめて、もう一度お試しください。';

export function AboutScreen() {
  const colors = useColors();
  const router = useRouter();
  const links = useMemo(
    () => buildAboutLinks({ privacyPolicy: PRIVACY_POLICY_URL, termsOfService: TERMS_OF_SERVICE_URL, contact: CONTACT_URL }),
    [],
  );
  const version = useMemo(() => versionLabel(readAppVersion()), []);
  const [error, setError] = useState<string | null>(null);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function open(url: string) {
    setError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setError(OPEN_FAILED);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          このアプリについて
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          {links.map((link) => (
            <Pressable
              key={link.key}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              accessibilityHint="ブラウザで開きます"
              onPress={() => void open(link.url)}
              style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed]}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{link.label}</Text>
              <MaterialCommunityIcons name="open-in-new" size={20} color={colors.textSecondary} />
            </Pressable>
          ))}
          {/* 押せない行。読み上げは、「バージョン、0.1.0」の1つにまとめる */}
          <View
            accessible
            accessibilityLabel={`バージョン、${version}`}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>バージョン</Text>
            <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{version}</Text>
          </View>
        </View>
        {error ? (
          <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
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
  section: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowValue: { fontSize: 15 },
  error: { fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
