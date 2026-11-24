// 固定費の一覧（設定の中。docs/screens.md 6章の「固定費」）。止まっている固定費を上にまとめて、理由を出す。行をタップすると編集の
// シート（`app/recurring-edit.tsx`）、「固定費を追加」で登録のシートを開く。
//
// 出す内容の組み立ては、画面の外の `src/services/recurringView.ts`（`npm test` で守る）。この画面は、それを並べるだけ。予定日や
// 負担額の計算も、止まっている理由の判断もしない（サーバーの値を、そのまま文字にする）。
//
// 画面を開いたとき・シートから戻ったときに、読み直す（`useFocusEffect`）。読み直しの失敗は、表示中の内容を残して知らせる。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recurringService } from '../../platform/recurringService.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import type { RecurringData } from '../../src/services/recurringService.ts';
import { buildRecurringSections, type RecurringRow } from '../../src/services/recurringView.ts';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RecurringData };

export function RecurringScreen({ groupId }: { groupId: string }) {
  const colors = useColors();
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの失敗（表示中の内容は残す）
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // 古い応答を捨てる印（読み直しを重ねたとき、遅れて届いた前の応答で上書きしない）
  const requestSeq = useRef(0);
  // 表示できる内容があるか（読み直しの失敗を、読み込みの失敗の表示にするか、表示中の内容を残して知らせるかの分かれ目）
  const hasData = useRef(false);

  const reload = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    try {
      const data = await recurringService.load(groupId);
      if (seq !== requestSeq.current) return;
      hasData.current = true;
      setLoad({ status: 'ready', data });
      setRefreshError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const message = loadHomeErrorMessage(e);
      if (hasData.current) setRefreshError(message);
      else setLoad({ status: 'error', message });
    }
  }, [groupId]);

  // 画面を開いたときと、シートから戻ったときに読み直す
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const sections = useMemo(() => (load.status === 'ready' ? buildRecurringSections(load.data) : null), [load]);

  function openEdit(recurringId: string | null) {
    if (load.status !== 'ready') return;
    const params: Record<string, string> = { groupId };
    if (recurringId !== null) params.recurringId = recurringId;
    router.push({ pathname: '/recurring-edit', params });
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  const empty = sections !== null && sections.paused.length + sections.active.length + sections.ended.length === 0;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          固定費
        </Text>
      </View>

      {load.status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" />
        </View>
      ) : load.status === 'error' ? (
        <View style={styles.centered}>
          <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
            {load.message}
          </Text>
          <PrimaryButton label="もう一度" onPress={() => void reload()} />
        </View>
      ) : sections !== null ? (
        <ScrollView contentContainerStyle={styles.content}>
          {refreshError !== null ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {refreshError}
            </Text>
          ) : null}

          {empty ? (
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              固定費はまだありません。家賃や光熱費など、毎月決まって払うものを登録すると、毎月の予定日に、自動で支出として登録します。
            </Text>
          ) : null}

          {sections.paused.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.error }]} accessibilityRole="header">
                止まっている固定費
              </Text>
              <View>
                {sections.paused.map((row) => (
                  <RecurringRowView key={row.id} row={row} onPress={() => openEdit(row.id)} />
                ))}
              </View>
            </View>
          ) : null}

          {sections.active.length > 0 ? (
            <View style={styles.block}>
              {sections.paused.length > 0 ? (
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                  登録している固定費
                </Text>
              ) : null}
              <View>
                {sections.active.map((row) => (
                  <RecurringRowView key={row.id} row={row} onPress={() => openEdit(row.id)} />
                ))}
              </View>
            </View>
          ) : null}

          <PrimaryButton label="固定費を追加" variant="secondary" onPress={() => openEdit(null)} />

          {sections.ended.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                終了した固定費
              </Text>
              <View>
                {sections.ended.map((row) => (
                  <RecurringRowView key={row.id} row={row} onPress={() => openEdit(row.id)} />
                ))}
              </View>
            </View>
          ) : null}

          <Text style={[styles.note, { color: colors.textSecondary }]}>
            固定費は、毎月の予定日に、ふつうの支出として自動で登録されます（アプリを開いていなくても登録されます）。登録された支出は、
            ホームから、ほかの支出と同じように直せます。固定費を変えても、登録済みの支出は変わりません。
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function RecurringRowView({ row, onPress }: { row: RecurringRow; onPress(): void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      accessibilityHint="編集します"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed, row.status === 'ended' && styles.dimmed]}
    >
      <CategoryIcon icon={row.categoryIcon} color={row.categoryColor} size={40} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>{row.detailText}</Text>
        {row.customSplit ? <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>この固定費だけ負担を変えています</Text> : null}
        {row.statusText !== null ? (
          <Text style={[styles.rowDetail, { color: row.attention ? colors.error : colors.textSecondary }]}>{row.statusText}</Text>
        ) : null}
      </View>
      <Text style={[styles.amount, { color: colors.textPrimary }]} numberOfLines={1}>
        {row.amountText}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 16 },
  block: { gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  amount: { fontSize: 16, fontWeight: '700', maxWidth: 130, textAlign: 'right' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
});
