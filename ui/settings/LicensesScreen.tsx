// ライセンス（「このアプリについて」の行から。docs/screens.md 6章）。アプリに入る、npmの依存・取り込まれたコード・アイコンフォント・
// ネイティブのライブラリの名前・版・ライセンスの種類を並べ、押すと全文（著作権表示を含む）を開く。
// MITなどは、著作権表示と許諾表示を含めることを求める。
//
// 一覧は、依存関係から生成したもの（`scripts/generate-licenses.mjs`。`src/legal/thirdPartyLicenses.ts`）で、手で直さない。
// 片方のOSにだけ入るもの（AndroidXなど）は、そのOSでだけ出す（`src/services/licenseView.ts`）。
// 画面は、RN・Expoに触れる部分だけ。全文は長いので、押したときだけ詰め直して（`reflowLicense`）出す。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { reflowLicense } from '../../src/legal/reflowLicense.ts';
import { THIRD_PARTY_LICENSE_TEXTS, THIRD_PARTY_PACKAGES } from '../../src/legal/thirdPartyLicenses.ts';
import { buildLicenseItems, type LicenseItem, licenseOsOf } from '../../src/services/licenseView.ts';
import { useColors } from '../useColors.ts';

export function LicensesScreen() {
  const colors = useColors();
  const router = useRouter();
  const items = useMemo(
    () => buildLicenseItems(THIRD_PARTY_PACKAGES, THIRD_PARTY_LICENSE_TEXTS, licenseOsOf(Platform.OS)),
    [],
  );

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
          ライセンス
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          このアプリは、次のオープンソースソフトウェアを使っています。押すと、ライセンスの全文を表示します。
        </Text>
        {items.map((item) => (
          <LicenseRow key={item.key} item={item} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// 名前と、版・ライセンスの種類。全文は長いので、押して開く。
function LicenseRow({ item }: { item: LicenseItem }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.item, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${item.name}、${item.detail}`}
        accessibilityHint={expanded ? '全文を閉じます' : '全文を表示します'}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.itemHeader, pressed && styles.pressed]}
      >
        <View style={styles.titles}>
          <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>{item.detail}</Text>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={colors.textSecondary}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      </Pressable>
      {expanded ? (
        <>
          {item.includes ? (
            <Text selectable style={[styles.includes, { color: colors.textSecondary }]}>
              {`含むもの:\n${item.includes.join('\n')}`}
            </Text>
          ) : null}
          <Text selectable style={[styles.licenseText, { color: colors.textSecondary }]}>
            {reflowLicense(item.text)}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  intro: { marginBottom: 8, fontSize: 14, lineHeight: 21 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
  itemHeader: {
    minHeight: 56,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titles: { flexShrink: 1, gap: 2 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  detail: { fontSize: 13, lineHeight: 18 },
  includes: { paddingBottom: 8, fontSize: 12, lineHeight: 17 },
  licenseText: { paddingBottom: 12, fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.7 },
});
