// カテゴリと負担割合の一覧（設定の中。docs/screens.md 6章）。選んだ月の、カテゴリごとの負担割合を出す。月は、締めていない月の間で
// 切り替えられる。行をタップすると編集のシート（`app/category-edit.tsx`）、「カテゴリを追加」で追加のシートを開く。
//
// 出す内容の組み立ては、画面の外の `src/services/categoryView.ts`（`npm test` で守る）。この画面は、それを並べるだけ。負担額の
// 計算も、割合が正しいかの判断もしない（サーバーの値を、そのまま文字にする）。
//
// - 画面を開いたとき・編集のシートから戻ったときに、読み直す（`useFocusEffect`）。読み直しの失敗は、表示中の内容を残して知らせる。
// - 月を切り替えるのは、その月の割合だけを読み直す。失敗したら、前の月のまま、失敗を知らせる（前の月の割合を、切り替えた月の
//   ものとして出さない）。
// - 並べ替えは、「並べ替え」ボタンで入る専用の状態（上下の矢印で動かして、「保存」で1回だけ送る。長押しのドラッグは、ネイティブの
//   依存を足すので作らず、スクリーンリーダーでも使える上下の操作にした）。並びの組み立ては `src/services/categoryReorder.ts`
//   （`npm test` で守る）。送るのは、アーカイブした費目も含む全費目（使っている費目の枠だけを入れ替える）。**その状態では、
//   行を押しても編集のシートは開かず、月の切り替え・追加・使わない費目は出さない**（保存の最中に、読み直しや別の画面が割り込まない）。
//   - **並べ替えの状態の戻る操作（ヘッダーの戻る・Androidの戻る）は、画面を出ず、並べ替えをやめる**（見出しが「並べ替え」に変わる
//     ので、一覧へ戻ると思う）。並びを変えていれば、破棄の確認を出す。通信の最中は、戻る操作が効かない。止めているのは
//     `beforeRemove` で、セッション切れの画面の除去（`Stack.Protected` のガードの切り替え）は通らない（`CategoryEditSheet.tsx`
//     と同じ）。招待URLによる参加確認への切り替えも、同じ除去だが、通信の最中だけは遅らせる（`useHoldInviteSwap`。`ui/inviteHold.ts`）。
//   - **読み直しの最中は、「並べ替え」に入れず、月も切り替えられない**（`refreshing`。入ると、読み直す前の並びで始まり、応答が届いた
//     あとに、並びが古い・変えていないのに「変えた」扱いになる。月の切り替えは、読み直しの応答を捨て、カテゴリを読み直す前のまま
//     にする）。並べ替えの状態では、読み直しは起きない（画面にフォーカスが戻るときだけ読み直し、
//     その状態では、行を押しても別の画面へ行けない）。
//   - 失敗のあとの扱いは `reorderFailureOutcome`（`src/services/categoryMessage.ts`）: 他のメンバーの操作で費目が変わったと断られたら
//     （`categories_changed`）、並べ替えをやめて読み直す。送り直しても通らない失敗（脱退が確定している・見つからない）は、並べ替え
//     をやめる。それ以外（通信の失敗・競合）は、並びを残して、もう一度押してもらう（同じ並びを送り直しても、同じ結果になる）。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { categoryErrorMessage, reorderFailureOutcome, staleReorderMessage } from '../../src/services/categoryMessage.ts';
import { applyReorder, buildReorderIds, isReordered, moveCategory, type MoveDirection } from '../../src/services/categoryReorder.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { memberLookup, moneyFormatters } from '../../src/services/homeView.ts';
import { Chips } from '../expense/Chips.tsx';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { useMounted } from '../useMounted.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CategorySettingsData };

export function CategoriesScreen({ groupId }: { groupId: string }) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの失敗（表示中の内容は残す）と、月の切り替えの失敗
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // 読み直しの最中か（この間は、並べ替えに入れない）
  const [refreshing, setRefreshing] = useState(false);
  // いま出している月（読み直しで、同じ月を選び直す）。古い応答を捨てる印（月の切り替えを重ねたとき、遅れて届いた前の応答で戻さない）
  const shownMonth = useRef<string | null>(null);
  const requestSeq = useRef(0);
  // 表示できる内容があるか（読み直しの失敗を、読み込みの失敗の表示にするか、表示中の内容を残して知らせるかの分かれ目）
  const hasData = useRef(false);
  // 並べ替え: 並べ替え中の、使っているカテゴリのID（並べ替えの状態でないときは `null`）、保存の最中か、保存の失敗の文言
  const [reorder, setReorder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  // 保存の最中は、招待URLによる参加確認への切り替えを遅らせる（`ui/inviteHold.ts`）
  useHoldInviteSwap(saving);
  // 外れたあとに、開いたままの破棄の確認から、画面を戻す操作を始めない（`ui/useMounted.ts`）
  const mounted = useMounted();
  const savingRef = useRef(false);
  const changedRef = useRef(false);
  const reorderingRef = useRef(false);

  const reload = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    setRefreshing(true);
    try {
      const data = await categoryService.load(groupId, shownMonth.current);
      if (seq !== requestSeq.current) return;
      shownMonth.current = data.month;
      hasData.current = true;
      setLoad({ status: 'ready', data });
      setRefreshError(null);
      setMonthError(null);
      // 月の切り替えの最中に読み直したときは、切り替えの応答を捨てる（`requestSeq`）ので、その「切り替え中」も、ここで終える
      setSwitching(false);
      setRefreshing(false);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setSwitching(false);
      setRefreshing(false);
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
    // 読み直しの最中は切り替えない（切り替えは、割合だけを読み、カテゴリは持っているものを使う。読み直しの応答を捨てると、
    // 編集する前のカテゴリのまま、一覧も並べ替えも出る）
    if (load.status !== 'ready' || switching || refreshing || month === shownMonth.current) return;
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
      byId,
    };
  }, [load]);

  // 並べ替えを始めたときの並び（使っているカテゴリ）と、変えたか
  const activeIds = useMemo(() => view?.active.map((row) => row.categoryId) ?? [], [view]);
  const changed = reorder !== null && isReordered(activeIds, reorder);
  changedRef.current = changed;

  reorderingRef.current = reorder !== null;

  // 通信の最中は戻らない。並べ替えの状態の戻る操作は、画面を出ずに、並べ替えをやめる（並びを変えていれば、破棄の確認を出す）。
  // **この画面が `beforeRemove` を通って外されるのは、ユーザーの戻る操作のときだけ、という前提**（いまは、セッション切れ・招待による
  // 切り替え〔`Stack.Protected`〕と、グループの切り替え〔`key` の作り直し〕は通らず、並べ替えの状態では別の画面へ移れない）。
  // 別の画面からこの画面を開く導線を足すときは、置き換え（`dangerouslySingular` など）で、この画面が `beforeRemove` を通って
  // 外されないか確かめる（止められると、画面が切り替わらないまま、並べ替えだけが終わる）。ホームの「内訳を見る」のカテゴリは、
  // この画面ではなく、編集のシート（`category-edit`）だけを開く（この画面は、開いているあいだ、ホームの上に積まれている）。
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (savingRef.current) {
        event.preventDefault();
        return;
      }
      if (!reorderingRef.current) return;
      event.preventDefault();
      if (!changedRef.current) {
        exitReorder();
        return;
      }
      Alert.alert('並べ替えを破棄しますか？', '変えた並びは保存されません。', [
        { text: '並べ替えを続ける', style: 'cancel' },
        {
          text: '破棄する',
          style: 'destructive',
          onPress: () => {
            // 外れたあとに開いたままだったダイアログから、何もしない（`ui/useMounted.ts`）
            if (mounted.current) exitReorder();
          },
        },
      ]);
    });
  }, [navigation]);

  function startReorder() {
    if (load.status !== 'ready' || switching || refreshing || saving || activeIds.length < 2) return;
    setReorder(activeIds);
    setReorderError(null);
    setRefreshError(null);
    setMonthError(null);
  }

  /** 並べ替えをやめる（変えた並びは捨てる）。通信の最中は何もしない。 */
  function exitReorder() {
    if (savingRef.current) return;
    setReorder(null);
    setReorderError(null);
  }

  function move(index: number, direction: MoveDirection) {
    if (saving || reorder === null) return;
    const next = moveCategory(reorder, index, direction);
    if (!isReordered(reorder, next)) return;
    setReorder(next);
    setReorderError(null);
    // 動かした行は、押したボタンの位置から離れる。スクリーンリーダーには、移った位置を伝える
    const row = view?.active.find((candidate) => candidate.categoryId === reorder[index]);
    if (row !== undefined) {
      AccessibilityInfo.announceForAccessibility(`${row.name}を${next.indexOf(row.categoryId) + 1}番目に移しました`);
    }
  }

  /** 読み直して、並べ替えをやめる。断られた理由（`message`）は、読み直しの失敗があれば、それより先に並べる。 */
  async function reloadWithNotice(message: string) {
    setReorder(null);
    await reload();
    setRefreshError((previous) => (previous === null ? message : `${message}\n\n${previous}`));
  }

  async function saveReorder() {
    if (load.status !== 'ready' || reorder === null || saving || savingRef.current) return;
    const ids = buildReorderIds(load.data.categories, reorder);
    if (ids === null) {
      // 並べ替えているあいだに、読み込んだ費目が変わった（送っても、断られる）
      await reloadWithNotice(staleReorderMessage());
      return;
    }
    if (!isReordered(activeIds, reorder)) {
      setReorder(null);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setReorderError(null);
    try {
      await categoryService.reorderCategories(groupId, ids);
      // 済んだ並びを、そのまま画面に持つ（読み直さない）。次に画面を開いたときの読み直しで、サーバーの値になる
      setLoad((current) =>
        current.status === 'ready'
          ? { status: 'ready', data: { ...current.data, categories: applyReorder(current.data.categories, ids) } }
          : current,
      );
      setReorder(null);
      AccessibilityInfo.announceForAccessibility('並べ替えを保存しました');
    } catch (e) {
      // 外れたあと（セッション切れ）は、何も続けない（読み直しの通信を、余分に出さない）
      if (!mounted.current) return;
      const message = categoryErrorMessage(e, 'reorder');
      switch (reorderFailureOutcome(e)) {
        case 'reload':
          await reloadWithNotice(message);
          break;
        case 'exit':
          setReorder(null);
          setRefreshError(message);
          AccessibilityInfo.announceForAccessibility(message);
          break;
        default:
          setReorderError(message);
          AccessibilityInfo.announceForAccessibility(message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function openEdit(categoryId: string | null) {
    // 月の切り替えの最中は開かない（まだ前の月の割合を持っていて、シートが前の月で開く。戻ったときの読み直しが、切り替えの
    // 応答を捨てて、選んだ月が前の月に戻ることもある）
    if (load.status !== 'ready' || switching || reorder !== null) return;
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
          {reorder !== null ? '並べ替え' : 'カテゴリと負担割合'}
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
        <>
          <ScrollView contentContainerStyle={styles.content}>
            {refreshError !== null ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {refreshError}
              </Text>
            ) : null}

            {reorder !== null ? (
              <>
                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  上下の矢印で、並びを変えます。この並びは、支出を登録するときのカテゴリの並びになります（グループのみんなで共通です）。
                </Text>
                {reorderError !== null ? (
                  <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                    {reorderError}
                  </Text>
                ) : null}
                <View style={[styles.list, saving && styles.dimmed]}>
                  {reorder.flatMap((categoryId, index) => {
                    const row = view.byId.get(categoryId);
                    return row === undefined
                      ? []
                      : [
                          <ReorderRowView
                            key={categoryId}
                            row={row}
                            first={index === 0}
                            last={index === reorder.length - 1}
                            disabled={saving}
                            onMove={(direction) => move(index, direction)}
                          />,
                        ];
                  })}
                </View>
              </>
            ) : (
              <>
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
                        disabled={switching || refreshing}
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
                    <CategoryRowView key={row.categoryId} row={row} disabled={switching} onPress={() => openEdit(row.categoryId)} />
                  ))}
                </View>

                <PrimaryButton label="カテゴリを追加" variant="secondary" disabled={switching} onPress={() => openEdit(null)} />
                {view.active.length >= 2 ? (
                  <PrimaryButton label="並べ替え" variant="secondary" disabled={switching || refreshing} onPress={startReorder} />
                ) : null}

                {view.archived.length > 0 ? (
                  <View style={styles.archivedBlock}>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                      使わないカテゴリ
                    </Text>
                    <View style={styles.list}>
                      {view.archived.map((row) => (
                        <CategoryRowView key={row.categoryId} row={row} disabled={switching} onPress={() => openEdit(row.categoryId)} />
                      ))}
                    </View>
                  </View>
                ) : null}

                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  負担割合の変更は、選んだ月とそれ以降の月に反映されます。締めた月は変わりません。
                  メンバーが増えたり減ったりして均等に戻した月は、そのままです。
                </Text>
              </>
            )}
          </ScrollView>

          {reorder !== null ? (
            // 下端に置く（カテゴリが多いと、一覧の下までスクロールしないと届かなくなる）。文字を大きくしたときのため、縦に並べる
            <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
              <PrimaryButton label="保存" busy={saving} disabled={!changed} onPress={() => void saveReorder()} />
              <PrimaryButton label="キャンセル" variant="secondary" disabled={saving} onPress={exitReorder} />
            </View>
          ) : null}
        </>
      ) : null}
    </SafeAreaView>
  );
}

function CategoryRowView({ row, disabled, onPress }: { row: CategoryRow; disabled: boolean; onPress(): void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.archived ? `${row.summary}、使わないカテゴリ` : row.summary}
      accessibilityHint="編集します"
      accessibilityState={{ disabled }}
      disabled={disabled}
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

function ReorderRowView({
  row,
  first,
  last,
  disabled,
  onMove,
}: {
  row: CategoryRow;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onMove(direction: MoveDirection): void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <CategoryIcon icon={row.icon} color={row.color} size={40} />
      <Text style={[styles.rowName, styles.rowBody, { color: colors.textPrimary }]} numberOfLines={1}>
        {row.name}
      </Text>
      <MoveButton label={`${row.name}を上へ`} icon="chevron-up" disabled={disabled || first} onPress={() => onMove('up')} />
      <MoveButton label={`${row.name}を下へ`} icon="chevron-down" disabled={disabled || last} onPress={() => onMove('down')} />
    </View>
  );
}

function MoveButton({ label, icon, disabled, onPress }: { label: string; icon: 'chevron-up' | 'chevron-down'; disabled: boolean; onPress(): void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.move, pressed && styles.pressed, disabled && styles.moveDisabled]}
    >
      <MaterialCommunityIcons name={icon} size={28} color={colors.textPrimary} />
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
  move: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  moveDisabled: { opacity: 0.3 },
  bar: { gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
});
