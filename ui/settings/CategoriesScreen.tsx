// カテゴリと負担割合の一覧（設定の中。docs/screens.md 6章）。選んだ月の、カテゴリごとの負担割合を出す。月は、締めていない月の間で
// 切り替えられる。行をタップすると編集のシート（`app/category-edit.tsx`）、「カテゴリを追加」で追加のシートを開く。
//
// 出す内容の組み立ては、画面の外の `src/services/categoryView.ts`（`npm test` で守る）。この画面は、それを並べるだけ。負担額の
// 計算も、割合が正しいかの判断もしない（サーバーの値を、そのまま文字にする）。
//
// - 画面を開いたとき・編集のシートから戻ったときに、読み直す（`useFocusEffect`）。読み直しの失敗は、表示中の内容を残して知らせる。
// - 月を切り替えるのは、その月の割合だけを読み直す。失敗したら、前の月のまま、失敗を知らせる（前の月の割合を、切り替えた月の
//   ものとして出さない）。
// - **まだ作っていない**: 並べ替え（`categoryRepository.reorder` は作ってある。長押しのドラッグか、上下の操作）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { categoryService } from '../../platform/categoryService.ts';
import { formatMonth } from '../../src/services/dateFormat.ts';
import type { CategorySettingsData } from '../../src/services/categoryService.ts';
import {
  buildCategoryRows,
  buildShareMonthOptions,
  orderShareMembers,
  splitArchived,
  type CategoryRow,
} from '../../src/services/categoryView.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { memberLookup, moneyFormatters } from '../../src/services/homeView.ts';
import { Chips } from '../expense/Chips.tsx';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CategorySettingsData };

export function CategoriesScreen({ groupId }: { groupId: string }) {
  const colors = useColors();
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの失敗（表示中の内容は残す）と、月の切り替えの失敗
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // いま出している月（読み直しで、同じ月を選び直す）。古い応答を捨てる印（月の切り替えを重ねたとき、遅れて届いた前の応答で戻さない）
  const shownMonth = useRef<string | null>(null);
  const requestSeq = useRef(0);
  // 表示できる内容があるか（読み直しの失敗を、読み込みの失敗の表示にするか、表示中の内容を残して知らせるかの分かれ目）
  const hasData = useRef(false);

  const reload = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    try {
      const data = await categoryService.load(groupId, shownMonth.current);
      if (seq !== requestSeq.current) return;
      shownMonth.current = data.month;
      hasData.current = true;
      setLoad({ status: 'ready', data });
      setRefreshError(null);
      setMonthError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const message = loadHomeErrorMessage(e);
      // 表示中の内容があれば、残して知らせる。無ければ、読み込みの失敗の表示
      if (hasData.current) setRefreshError(message);
      else setLoad({ status: 'error', message });
    }
  }, [groupId]);

  // 画面を開いたときと、編集のシートから戻ったときに読み直す
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function selectMonth(month: string) {
    if (load.status !== 'ready' || month === shownMonth.current) return;
    const seq = (requestSeq.current += 1);
    setSwitching(true);
    setMonthError(null);
    try {
      const shares = await categoryService.loadShares(groupId, month);
      if (seq !== requestSeq.current) return;
      shownMonth.current = month;
      setLoad({ status: 'ready', data: { ...load.data, month, shares } });
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setMonthError(loadHomeErrorMessage(e));
    } finally {
      if (seq === requestSeq.current) setSwitching(false);
    }
  }

  const view = useMemo(() => {
    if (load.status !== 'ready') return null;
    const { data } = load;
    const lookup = memberLookup(data.group);
    const { money } = moneyFormatters(data.group);
    const memberOrder = orderShareMembers(data.shares?.memberIds ?? [], data.group.members);
    const rows = buildCategoryRows(data.categories, data.shares, { memberOrder, memberName: lookup.name, money });
    const byId = new Map(rows.map((row) => [row.categoryId, row]));
    const { active, archived } = splitArchived(data.categories);
    return {
      active: active.map((category) => byId.get(category.id)!),
      archived: archived.map((category) => byId.get(category.id)!),
      months: buildShareMonthOptions(data.months.months, data.month),
    };
  }, [load]);

  function openEdit(categoryId: string | null) {
    if (load.status !== 'ready') return;
    const params: Record<string, string> = { groupId };
    if (categoryId !== null) params.categoryId = categoryId;
    if (load.data.month !== null) params.month = load.data.month;
    router.push({ pathname: '/category-edit', params });
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  const data = load.status === 'ready' ? load.data : null;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          カテゴリと負担割合
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
      ) : data !== null && view !== null ? (
        <ScrollView contentContainerStyle={styles.content}>
          {refreshError !== null ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {refreshError}
            </Text>
          ) : null}

          {data.month === null ? (
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              締めていない月がないため、負担割合は変えられません。カテゴリの名前などは、変えられます。
            </Text>
          ) : (
            <View style={styles.monthBlock}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                {formatMonth(data.month)}の負担割合
              </Text>
              {view.months.length > 1 ? (
                <Chips
                  options={view.months.map((option) => ({ key: option.month, label: option.label }))}
                  selected={data.month}
                  disabled={switching}
                  onSelect={(month) => void selectMonth(month)}
                />
              ) : null}
              {monthError !== null ? (
                <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {monthError}
                </Text>
              ) : null}
              {data.shares !== null && !data.shares.editable ? (
                <Text style={[styles.note, { color: colors.textSecondary }]}>この月の割合は、変えられません。</Text>
              ) : null}
            </View>
          )}

          <View style={[styles.list, switching && styles.dimmed]}>
            {view.active.map((row) => (
              <CategoryRowView key={row.categoryId} row={row} onPress={() => openEdit(row.categoryId)} />
            ))}
          </View>

          <PrimaryButton label="カテゴリを追加" variant="secondary" onPress={() => openEdit(null)} />

          {view.archived.length > 0 ? (
            <View style={styles.archivedBlock}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                使わないカテゴリ
              </Text>
              <View style={styles.list}>
                {view.archived.map((row) => (
                  <CategoryRowView key={row.categoryId} row={row} onPress={() => openEdit(row.categoryId)} />
                ))}
              </View>
            </View>
          ) : null}

          <Text style={[styles.note, { color: colors.textSecondary }]}>
            負担割合の変更は、選んだ月とそれ以降の月に反映されます。締めた月は変わりません。
            メンバーが増えたり減ったりして均等に戻した月は、そのままです。
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function CategoryRowView({ row, onPress }: { row: CategoryRow; onPress(): void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.archived ? `${row.summary}、使わないカテゴリ` : row.summary}
      accessibilityHint="編集します"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && styles.pressed, row.archived && styles.dimmed]}
    >
      <CategoryIcon icon={row.icon} color={row.color} size={40} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: colors.textPrimary }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.capText !== null ? (
          <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>{row.capText}</Text>
        ) : null}
      </View>
      {row.ratioText !== null ? (
        <Text style={[styles.ratio, { color: colors.textPrimary }]} numberOfLines={1}>
          {row.ratioText}
        </Text>
      ) : null}
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
  monthBlock: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  list: { gap: 0 },
  archivedBlock: { gap: 8, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  ratio: { fontSize: 16, fontWeight: '700', maxWidth: 170, textAlign: 'right' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
});
