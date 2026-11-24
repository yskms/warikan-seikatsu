// ホーム（docs/screens.md 3章）。選んだ月の、支出の総額・メンバー別の負担額・精算・支出の一覧を、1画面の縦スクロールで出す。
// 初期表示は、サーバーが返す今月（`currentMonth`）。月は、上部の切り替えか、お知らせのタップで変える。
//
// 支出の行をタップすると、編集のシートを開く（登録は、下のナビの＋。どちらも `app/expense.tsx`）。**まだ作っていない**もの
// （それぞれ、作るときにここへ足す）:
// - 月締め・精算完了・繰越（5章）
// - お知らせのうち「メンバーが増減した」「固定費が止まった」と、1人だけのグループの「相手を招待する」カード（招待の発行を作るとき）
// - 複数のグループの切り替えと、最後に開いたグループを覚えること（`ui/GroupGate.tsx`。いまは作成の古い順の先頭を出す）
//
// 読み込みの流れ: グループ（メンバー）・月の一覧・費目を読み、選ぶ月を決めてから、その月の集計と支出を読む。
// 画面を開いたとき・ホームへ戻ったとき・引っ張ったときに取り直す（1章。プッシュ通知やリアルタイム更新はしない）。取り直しの
// 失敗は、表示中のデータを残したまま知らせる（読み込めた分を消さない）。読み込みの状態と、古い応答を捨てる規則は、画面の外の
// `src/services/homeLoader.ts` にあり（`npm test` で守る）、この画面は、その状態を購読して並べるだけ。
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { expenseNotice } from '../../platform/expenseService.ts';
import { homeService } from '../../platform/homeService.ts';
import { formatMonthShort } from '../../src/services/dateFormat.ts';
import { createHomeLoader, currentMonthData } from '../../src/services/homeLoader.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import {
  buildBreakdown,
  buildExpenseRows,
  buildMemberBurdens,
  buildMonthOptions,
  buildNotices,
  buildSettlement,
  buildTotal,
  memberLookup,
  moneyFormatters,
  neighborMonths,
} from '../../src/services/homeView.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { ExpenseSection } from './ExpenseSection.tsx';
import { MonthHeader } from './MonthHeader.tsx';
import { SettlementCard } from './SettlementCard.tsx';
import { BreakdownSection, MemberBurdens, NoticeList, TotalCard } from './SummarySections.tsx';

interface HomeScreenProps {
  groupId: string;
  groupName: string;
}

export function HomeScreen({ groupId, groupName }: HomeScreenProps) {
  const colors = useColors();
  // 読み込みの状態を持つ入れ物なので、`useMemo`（Reactが捨てて作り直すことがある）ではなく `useState` で持つ。
  // グループが変わるときは、呼び出し側が `key` を変えて、この画面ごと作り直す（`app/index.tsx`）。`groupId` は、作ったあとは変えない。
  const [loader] = useState(() =>
    createHomeLoader({ service: homeService, groupId, errorMessage: loadHomeErrorMessage }),
  );
  const state = useSyncExternalStore(loader.subscribe, loader.getState);
  const { group: groupData, selected, error, refreshing } = state;
  const router = useRouter();
  // 支出を保存して戻ってきたとき、見ている月と違う月に保存したことを知らせる（ホームの月は切り替えない）
  const [savedMonth, setSavedMonth] = useState<string | null>(null);

  // 画面を開いたときと、ホームへ戻ったとき（ほかの画面・シートから）に取り直す
  useFocusEffect(
    useCallback(() => {
      const saved = expenseNotice.take();
      if (saved !== null) setSavedMonth(saved);
      void loader.reload(false);
    }, [loader]),
  );
  // お知らせは、しばらくしたら消す。見ている月を、保存した月へ切り替えたときも消す
  useEffect(() => {
    if (savedMonth === null) return undefined;
    const timer = setTimeout(() => setSavedMonth(null), 5000);
    return () => clearTimeout(timer);
  }, [savedMonth]);

  // 選んだ月のデータが届いているか（月を切り替えた直後や、切り替えに失敗したあとは、前の月のデータを出さない）
  const current = currentMonthData(state);

  const view = useMemo(() => {
    if (groupData === null || current === null) return null;
    const formatters = moneyFormatters(groupData.group);
    const lookup = memberLookup(groupData.group, current.summary);
    return {
      total: buildTotal(current.summary, formatters.money),
      burdens: buildMemberBurdens(current.summary, lookup, formatters.money),
      breakdown: buildBreakdown(current.summary, lookup, groupData.categories, formatters),
      settlement: buildSettlement(current.summary, lookup, formatters.money),
      rows: buildExpenseRows(current.expenses.expenses, groupData.categories, lookup, formatters.money),
    };
  }, [groupData, current]);

  const months = groupData?.months.months ?? [];
  const neighbors = selected === null ? { previous: null, next: null } : neighborMonths(months, selected);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loader.reload(true)} />}
      >
        <Text style={[styles.groupName, { color: colors.textSecondary }]} accessibilityRole="header" numberOfLines={1}>
          {groupData?.group.name ?? groupName}
        </Text>

        {selected !== null && groupData !== null ? (
          <MonthHeader
            month={selected}
            previous={neighbors.previous}
            next={neighbors.next}
            options={buildMonthOptions(months, selected)}
            onSelect={(month) => void loader.selectMonth(month)}
          />
        ) : null}

        {savedMonth !== null && selected !== null && savedMonth !== selected ? (
          <Text
            style={[styles.saved, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {formatMonthShort(savedMonth)}分として登録しました
          </Text>
        ) : null}

        {/* 取り直しに失敗したとき。表示中のデータは残す。まだ何も読めていないときと、月のデータが届いていないときは、
            下の本体の代わりに、再試行のボタンつきで出す */}
        {error !== null && view !== null ? (
          <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {view !== null && current !== null && groupData !== null && selected !== null ? (
          <>
            <NoticeList
              notices={buildNotices(selected, months, current.summary.close)}
              onSelectMonth={(month) => void loader.selectMonth(month)}
            />
            <TotalCard total={view.total} />
            <MemberBurdens items={view.burdens} />
            <BreakdownSection breakdown={view.breakdown} />
            <SettlementCard model={view.settlement} />
            <ExpenseSection
              rows={view.rows}
              onOpen={(expenseId) =>
                router.push({ pathname: '/expense', params: { groupId, expenseId, month: selected } })
              }
            />
          </>
        ) : error !== null ? (
          <View style={styles.errorBlock}>
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
            <PrimaryButton label="もう一度" onPress={() => void loader.reload(false)} />
          </View>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 20 },
  groupName: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorBlock: { gap: 16, paddingVertical: 24 },
  loading: { paddingVertical: 48 },
  saved: { fontSize: 14, fontWeight: '600', textAlign: 'center', borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, overflow: 'hidden' },
});
