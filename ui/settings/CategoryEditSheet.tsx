// カテゴリの追加・編集のシート（docs/screens.md 6章「カテゴリの編集」）。下から出るモーダル（`app/category-edit.tsx`）の中身。
//
// 内容は、**開くときに読み直した**もの（`categoryService.load`）で出す。入力の検査・保存の組み立ては、画面の外の
// `src/services/categoryForm.ts`（`npm test` で守る）。この画面は、入力欄を並べて、押されたものを渡すだけ。**負担額の計算も、
// プレビューも出さない**（CLAUDE.md。上限額つきの例を、入力した値でその場に出す案は、計算をアプリに書き写すので作っていない）。
//
// - 並びは、名前、負担割合、アイコン、色、使わない設定の順（この画面の主な用途は割合を直すことで、アイコン・色の選択肢は縦に長い
//   ので、割合を下に置くと、スクロールしないと届かない）。
// - 追加は、名前・アイコン・色だけ（割合は、サーバーが均等で作る。直すのは、追加したあとに一覧から）。
// - 編集の保存は、変えたものだけを送る（名前・アイコン・色は `PATCH`、割合・上限額は `PUT`。2つの呼び出し）。名前などが
//   済んで割合が断られたら、名前などは済んだこととして残し、やり直すときは割合だけを送る。
// - 追加の `id` は、最初に保存を押したときに1回だけ作り、やり直しでも使い回す（結果が分からない失敗のあとで、同じカテゴリが
//   2つにならない）。**サーバーは、同じ `id` の再送に、保存済みの費目をそのまま返す**（内容は見比べない）ので、結果が分からない
//   失敗のあとに入力を直して送り直すと、直した内容が反映されない。そのため、その送り直しのあとに、直した内容を `PATCH` で送る。
//   追加の 409 `conflict` は、この `id` を他のグループが使っているとき（同じ `id` では直らない）なので、新しい `id` にする。
// - 他のメンバーの操作で古くなった（競合・メンバーの増減・月が締まった）と断られたら、読み直して、入力を新しい内容から作り直す
//   （編集だけ。追加は、入力を残す）。
// - 通信の最中は、✕も、戻る操作も効かない。変えた入力があるときの✕・戻る操作は、破棄の確認を出す。止めているのは `beforeRemove`
//   で、セッション切れの画面の除去（`Stack.Protected` のガードの切り替え）は通らない（`ExpenseSheet.tsx` と同じ）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { categoryService } from '../../platform/categoryService.ts';
import { newId } from '../../platform/randomId.ts';
import { formatMonth } from '../../src/services/dateFormat.ts';
import {
  applyEqual,
  applyPreset,
  buildCreateInput,
  buildSavePlan,
  canEditShares,
  CATEGORY_COLOR_KEYS,
  checkDraft,
  disableCap,
  draftFromCategory,
  enableCap,
  hasChanges,
  isDirty,
  MAX_CATEGORY_NAME_LENGTH,
  newDraft,
  RATIO_PRESETS,
  setCapMember,
  setPercentText,
  type CategoryDraft,
  type CategoryFormContext,
} from '../../src/services/categoryForm.ts';
import {
  categoryErrorMessage,
  isCreateIdConflict,
  resultUnknown,
  shouldReloadAfter,
} from '../../src/services/categoryMessage.ts';
import type { CategorySettingsData } from '../../src/services/categoryService.ts';
import { orderShareMembers } from '../../src/services/categoryView.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { initialOf } from '../../src/services/homeView.ts';
import { percentText } from '../../src/services/expenseForm.ts';
import { categoryColorLabel, categoryIconLabel, CATEGORY_ICON_KEYS } from '../../src/theme/categoryIcons.ts';
import { paletteColor } from '../../src/theme/palette.ts';
import { Chips } from '../expense/Chips.tsx';
import { Avatar } from '../home/Avatar.tsx';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { TextField } from '../TextField.tsx';
import { useColors } from '../useColors.ts';

interface CategoryEditSheetProps {
  groupId: string;
  /** 編集するカテゴリ。追加のときは `null` */
  categoryId: string | null;
  /** 負担割合を出している月（`YYYY-MM`）。締めていない月が無いときは `null` */
  month: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CategorySettingsData; draft: CategoryDraft };

/** 読み込んだ内容から、フォームの前提（`CategoryFormContext`）を作る。 */
function contextOf(data: CategorySettingsData, categoryId: string | null): CategoryFormContext | null {
  const editing = categoryId === null ? null : (data.categories.find((category) => category.id === categoryId) ?? null);
  // 編集するカテゴリが見つからない（他のメンバーが…ことはないが、グループを抜けた・食い違い）
  if (categoryId !== null && editing === null) return null;
  return {
    memberOrder: orderShareMembers(data.shares?.memberIds ?? [], data.group.members),
    minorUnit: data.group.currencyMinorUnit,
    currencyCode: data.group.currencyCode,
    editing,
    rule: editing === null ? null : (data.shares?.categories.find((rule) => rule.categoryId === editing.id) ?? null),
    shareEditable: data.shares?.editable ?? false,
  };
}

function initialDraft(data: CategorySettingsData, ctx: CategoryFormContext): CategoryDraft {
  return ctx.editing === null ? newDraft(data.categories) : draftFromCategory(ctx.editing, ctx.rule, ctx);
}

export function CategoryEditSheet({ groupId, categoryId, month }: CategoryEditSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const leaving = useRef(false);
  // 追加の識別子と、結果が分からない失敗があったか（上のコメント）
  const createId = useRef<string | null>(null);
  const createUncertain = useRef(false);
  // 名前・アイコン・色の保存が済んだか（そのあとの破棄の確認の文言が、事実と合うように）
  const profileSaved = useRef(false);
  // 読み込んだときの入力（変えたかの判定。保存で名前などが済んだら、その内容に更新する）
  const baseline = useRef<CategoryDraft | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    categoryService.load(groupId, month).then(
      (data) => {
        if (cancelled) return;
        const ctx = contextOf(data, categoryId);
        if (ctx === null) {
          setLoad({ status: 'error', message: 'このカテゴリを確認できませんでした。一覧に戻って、もう一度お試しください。' });
          return;
        }
        const draft = initialDraft(data, ctx);
        baseline.current = draft;
        setLoad({ status: 'ready', data, draft });
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadHomeErrorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, categoryId, month, attempt]);

  const ctx = useMemo(() => (load.status === 'ready' ? contextOf(load.data, categoryId) : null), [load, categoryId]);
  const draft = load.status === 'ready' ? load.draft : null;
  dirty.current = draft !== null && baseline.current !== null && isDirty(draft, baseline.current);

  /** 破棄・「使わない」で、捨てることになる入力の説明。名前などが保存済みなら、それは残ると伝える */
  function unsavedNote(): string {
    return profileSaved.current
      ? '先に保存した名前・アイコン・色は、そのまま残ります。ほかの入力した変更は保存されません。'
      : '入力した変更は保存されません。';
  }

  // 通信の最中は閉じない。変えた入力があるときは、破棄の確認を出す
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      if (running.current) {
        event.preventDefault();
        return;
      }
      if (!dirty.current) return;
      event.preventDefault();
      Alert.alert('変更を破棄しますか？', unsavedNote(), [
        { text: '編集を続ける', style: 'cancel' },
        {
          text: '破棄する',
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
  }, [navigation]);

  function leave() {
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/categories', params: { groupId } });
  }

  function update(next: CategoryDraft) {
    setLoad((current) => (current.status === 'ready' ? { ...current, draft: next } : current));
    // 入力を直したら、前の失敗の文言は消す（直したあとの保存の結果ではないため）
    setError(null);
  }

  /** 読み直して、入力を新しい内容から作り直す（断られたあと）。読み直せなければ、読み込みの失敗の表示にする */
  async function reloadAfterRejection(message: string) {
    try {
      const data = await categoryService.load(groupId, month);
      const fresh = contextOf(data, categoryId);
      if (fresh === null) {
        setLoad({ status: 'error', message });
        return;
      }
      const next = initialDraft(data, fresh);
      baseline.current = next;
      setLoad({ status: 'ready', data, draft: next });
      setError(message);
    } catch (reloadError) {
      // 断られた理由は、捨てずに並べる
      setLoad({ status: 'error', message: `${message}\n\n${loadHomeErrorMessage(reloadError)}` });
    }
  }

  async function run(task: () => Promise<void>, action: 'save-share' | 'create' | 'update') {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      const message = categoryErrorMessage(e, action);
      if (action === 'create' && isCreateIdConflict(e)) {
        // この `id` を他のグループが使っている。同じ `id` では直らないので、次に押したときは、新しい `id` にする
        createId.current = null;
        createUncertain.current = false;
      }
      if (shouldReloadAfter(e, action)) await reloadAfterRejection(message);
      else setError(message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function save() {
    if (load.status !== 'ready' || ctx === null) return;
    const { data } = load;
    const current = load.draft;
    const check = checkDraft(current, ctx);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (ctx.editing === null) {
      void run(async () => {
        createId.current ??= newId();
        const body = buildCreateInput(check, current);
        // 前の送信の結果が分からないまま送り直すとき、サーバーは保存済みの費目をそのまま返す（上のコメント）。入力が変わって
        // いても、直した内容が反映されるよう、送り直したあとに `PATCH` で確かめる（同じ内容なら、何も変わらない）
        const retry = createUncertain.current;
        try {
          const created = await categoryService.createCategory(groupId, { id: createId.current, ...body });
          if (retry) await categoryService.updateCategory(created.id, body);
        } catch (e) {
          if (resultUnknown(e)) createUncertain.current = true;
          throw e;
        }
        leave();
      }, 'create');
      return;
    }
    const editing = ctx.editing;
    const plan = buildSavePlan(check, current, ctx);
    if (!hasChanges(plan)) {
      leave();
      return;
    }
    void run(async () => {
      if (plan.profile !== null) {
        await categoryService.updateCategory(editing.id, plan.profile);
        profileSaved.current = true;
        // 名前などは済んだ。割合が断られても、やり直しでは名前などを送り直さない（開いたときの値を、済んだ内容に更新する）
        const saved = { ...editing, ...plan.profile };
        setLoad((state) =>
          state.status === 'ready'
            ? { ...state, data: { ...data, categories: data.categories.map((c) => (c.id === saved.id ? saved : c)) } }
            : state,
        );
        if (baseline.current !== null) {
          baseline.current = {
            ...baseline.current,
            name: check.name,
            icon: current.icon,
            color: current.color,
          };
        }
      }
      if (plan.shares !== null && data.month !== null) {
        const result = await categoryService.saveShare(groupId, data.month, editing.id, plan.shares);
        if (result.overriddenMonths.length > 0) {
          const months = result.overriddenMonths.map(formatMonth).join('、');
          await new Promise<void>((resolve) => {
            Alert.alert('保存しました', `${months}には、別の設定があるため、変えていません。`, [{ text: 'OK', onPress: () => resolve() }], {
              onDismiss: () => resolve(),
            });
          });
        }
      }
      leave();
    }, 'update');
  }

  function confirmArchive(archived: boolean) {
    if (ctx?.editing == null) return;
    const editing = ctx.editing;
    const title = archived ? 'このカテゴリを使わなくしますか？' : 'このカテゴリをまた使いますか？';
    const base = archived
      ? '過去の支出と割合は残ります。新しい支出では選べなくなります。あとから、また使えるようにできます。'
      : '新しい支出で、選べるようになります。';
    // 入力を直したあとに押すと、そのまま閉じて、直した内容は保存されない（破棄の確認は出ない）ので、ここで伝える
    const body = dirty.current ? `${base}\n\n${unsavedNote()}` : base;
    Alert.alert(title, body, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: archived ? '使わなくする' : 'また使う',
        style: archived ? 'destructive' : 'default',
        onPress: () => {
          void run(async () => {
            await categoryService.updateCategory(editing.id, { archived });
            leave();
          }, 'update');
        },
      },
    ]);
  }

  const title = categoryId === null ? 'カテゴリを追加' : 'カテゴリを編集';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          hitSlop={8}
          disabled={busy}
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <MaterialCommunityIcons name="close" size={26} color={colors.textPrimary} />
        </Pressable>
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
          <PrimaryButton label="もう一度" onPress={() => setAttempt((n) => n + 1)} />
          <PrimaryButton label="閉じる" variant="secondary" onPress={() => router.back()} />
        </View>
      ) : ctx !== null && draft !== null ? (
        // アプリは edge-to-edge なので、Androidでも `padding` を指定する（CLAUDE.md）
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TextField
              label="名前"
              value={draft.name}
              onChangeText={(name) => update({ ...draft, name })}
              maxLength={MAX_CATEGORY_NAME_LENGTH * 2}
              editable={!busy}
              placeholder="例: 美容"
            />

            {canEditShares(ctx) && load.data.month !== null ? (
              <ShareEditor
                draft={draft}
                ctx={ctx}
                data={load.data}
                month={load.data.month}
                disabled={busy}
                onChange={update}
              />
            ) : ctx.editing !== null ? (
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                {load.data.month === null
                  ? '締めていない月がないため、負担割合は変えられません。'
                  : ctx.rule === null
                    ? `${formatMonth(load.data.month)}には、このカテゴリの負担割合がありません。`
                    : `${formatMonth(load.data.month)}の負担割合は、変えられません。`}
              </Text>
            ) : (
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                負担割合は、はじめは均等になります。追加したあと、一覧から変えられます。
              </Text>
            )}

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>アイコン</Text>
              <View style={styles.grid} accessibilityRole="radiogroup">
                {CATEGORY_ICON_KEYS.map((key) => (
                  <Swatch
                    key={key}
                    label={categoryIconLabel(key)}
                    selected={draft.icon === key}
                    disabled={busy}
                    onPress={() => update({ ...draft, icon: key })}
                  >
                    <CategoryIcon icon={key} color={draft.color} size={40} />
                  </Swatch>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>色</Text>
              <View style={styles.grid} accessibilityRole="radiogroup">
                {CATEGORY_COLOR_KEYS.map((key) => (
                  <Swatch
                    key={key}
                    label={categoryColorLabel(key)}
                    selected={draft.color === key}
                    disabled={busy}
                    onPress={() => update({ ...draft, color: key })}
                  >
                    <View style={[styles.colorDot, { backgroundColor: paletteColor(key) }]} />
                  </Swatch>
                ))}
              </View>
            </View>

            {ctx.editing !== null ? (
              <View style={styles.section}>
                <PrimaryButton
                  label={ctx.editing.archived ? 'このカテゴリをまた使う' : 'このカテゴリを使わない'}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => confirmArchive(!ctx.editing!.archived)}
                />
                {!ctx.editing.archived ? (
                  <Text style={[styles.note, { color: colors.textSecondary }]}>
                    過去の支出は残ります。新しい支出では選べなくなります。
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.bottom, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            {error !== null ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <PrimaryButton label={categoryId === null ? '追加する' : '保存する'} busy={busy} onPress={save} />
            <PrimaryButton label="キャンセル" variant="secondary" disabled={busy} onPress={() => router.back()} />
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

/** 負担割合と上限額の入力。割合は%で、2人のときは、よく使う割合のボタンもある。 */
function ShareEditor({
  draft,
  ctx,
  data,
  month,
  disabled,
  onChange,
}: {
  draft: CategoryDraft;
  ctx: CategoryFormContext;
  data: CategorySettingsData;
  month: string;
  disabled: boolean;
  onChange(draft: CategoryDraft): void;
}) {
  const colors = useColors();
  const members = ctx.memberOrder.map((id) => data.group.members.find((member) => member.id === id));
  const nameOf = (id: string) => data.group.members.find((member) => member.id === id)?.displayName ?? '削除されたユーザー';
  const two = ctx.memberOrder.length === 2;
  const firstPercent = two ? draft.percents[ctx.memberOrder[0]!] : undefined;
  const selectedPreset = RATIO_PRESETS.find((basisPoints) => percentText(basisPoints) === firstPercent);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
        {draft.capEnabled ? `上限を超えた分の割合（${formatMonth(month)}から）` : `負担割合（${formatMonth(month)}から）`}
      </Text>

      {two ? (
        <Chips
          options={RATIO_PRESETS.map((basisPoints) => ({
            key: String(basisPoints),
            label: `${basisPoints / 1000}:${(10000 - basisPoints) / 1000}`,
            note: `${nameOf(ctx.memberOrder[0]!)}が${basisPoints / 100}%`,
          }))}
          selected={selectedPreset === undefined ? null : String(selectedPreset)}
          disabled={disabled}
          onSelect={(key) => onChange(applyPreset(draft, ctx, Number(key)))}
        />
      ) : null}

      {ctx.memberOrder.map((memberId, index) => {
        const member = members[index];
        const name = nameOf(memberId);
        return (
          <View key={memberId} style={styles.shareRow}>
            <Avatar initial={initialOf(name)} color={member?.color ?? 'gray'} size={32} />
            <Text style={[styles.shareName, { color: colors.textPrimary }]} numberOfLines={1}>
              {name}
            </Text>
            <TextInput
              accessibilityLabel={`${name}の割合（パーセント）`}
              value={draft.percents[memberId] ?? ''}
              onChangeText={(text) => onChange(setPercentText(draft, ctx, memberId, text))}
              editable={!disabled}
              keyboardType="decimal-pad"
              maxLength={6}
              selectTextOnFocus
              style={[styles.percentInput, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
            />
            <Text style={[styles.percentSign, { color: colors.textSecondary }]}>%</Text>
          </View>
        );
      })}

      {!two ? (
        <PrimaryButton label="均等にする" variant="secondary" compact disabled={disabled} onPress={() => onChange(applyEqual(draft, ctx))} />
      ) : null}

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={[styles.switchLabel, { color: colors.textPrimary }]}>上限額をつける</Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            月の合計が上限額までは、選んだ人が全額を負担します。超えた分を、上の割合で分けます。
          </Text>
        </View>
        <Switch
          accessibilityLabel="上限額をつける"
          value={draft.capEnabled}
          disabled={disabled}
          onValueChange={(on) => onChange(on ? enableCap(draft, ctx) : disableCap(draft))}
        />
      </View>

      {draft.capEnabled ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>上限まで負担する人</Text>
          <Chips
            wrap
            options={ctx.memberOrder.map((id) => ({ key: id, label: nameOf(id) }))}
            selected={draft.capMemberId}
            disabled={disabled}
            onSelect={(id) => onChange(setCapMember(draft, ctx, id))}
          />
          <TextField
            label={`上限額（月あたり。${ctx.currencyCode}）`}
            value={draft.capAmount}
            onChangeText={(capAmount) => onChange({ ...draft, capAmount: capAmount.replace(/,/g, '.').replace(/[^0-9.]/g, '') })}
            editable={!disabled}
            // 小数のある通貨（USDなど）は、小数点のある数字キーボード
            keyboardType={ctx.minorUnit > 0 ? 'decimal-pad' : 'number-pad'}
            maxLength={16}
            placeholder="例: 10000"
          />
        </View>
      ) : null}
    </View>
  );
}

/** アイコン・色の選択肢（丸。選んでいるものは枠で示す）。 */
function Swatch({
  label,
  selected,
  disabled,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.swatch, { borderColor: selected ? colors.textPrimary : 'transparent' }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 18, fontWeight: '700' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 20 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 38, height: 38, borderRadius: 19 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareName: { flex: 1, fontSize: 16, fontWeight: '600' },
  percentInput: { width: 84, height: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, fontSize: 17, textAlign: 'right' },
  percentSign: { fontSize: 15, width: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  switchText: { flex: 1, gap: 4 },
  switchLabel: { fontSize: 16, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 19 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  bottom: { gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
