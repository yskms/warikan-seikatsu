// ホーム（docs/screens.md 3章）。選んだ月の、支出の総額・メンバー別の負担額・精算・支出の一覧を、1画面の縦スクロールで出す。
// 初期表示は、サーバーが返す今月（`currentMonth`）。月は、上部の切り替えか、お知らせのタップで変える。
//
// **いまは読み取り専用**で、次はまだ作っていない（それぞれ、作るときにここへ足す）:
// - 下のナビ（ホーム・＋・設定）と、支出の登録・編集（4章）、月締め・精算完了・繰越（5章）、設定（6章）
// - お知らせのうち「メンバーが増減した」「固定費が止まった」と、1人だけのグループの「相手を招待する」カード（招待の発行を作るとき）
// - 複数のグループの切り替えと、最後に開いたグループを覚えること（`app/index.tsx`。いまは作成の古い順の先頭を出す）
// - ログアウトは仮の置き場（画面の最後）。設定を作るときに、そちらへ移す（`ui/useSignOut.ts`）
//
// 読み込みの流れ: グループ（メンバー）・月の一覧・費目を読み、選ぶ月を決めてから、その月の集計と支出を読む。
// 画面を開いたとき・ホームへ戻ったとき・引っ張ったときに取り直す（1章。プッシュ通知やリアルタイム更新はしない）。取り直しの
// 失敗は、表示中のデータを残したまま知らせる（読み込めた分を消さない）。読み込みの状態と、古い応答を捨てる規則は、画面の外の
// `src/services/homeLoader.ts` にあり（`npm test` で守る）、この画面は、その状態を購読して並べるだけ。
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { homeService } from '../../platform/homeService.ts';
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
import { useSignOut } from '../useSignOut.ts';
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
  const { confirmSignOut, busy: signingOut, error: signOutError } = useSignOut();

  // 画面を開いたときと、ホームへ戻ったとき（ほかの画面から）に取り直す
  useFocusEffect(
    useCallback(() => {
      void loader.reload(false);
    }, [loader]),
  );

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
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
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
            <ExpenseSection rows={view.rows} />
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

        {/* 仮の置き場。読み込みに失敗したままでも、ログアウトできるようにする（先へ進めなくなるのを避ける）。
            設定を作るとき、そちらへ移す */}
        <View style={styles.footer}>
          {signOutError ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {signOutError}
            </Text>
          ) : null}
          <PrimaryButton label="ログアウト" variant="secondary" busy={signingOut} onPress={confirmSignOut} />
        </View>
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
  footer: { gap: 12, marginTop: 16 },
});
