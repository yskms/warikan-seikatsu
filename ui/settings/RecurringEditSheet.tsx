// 固定費の登録・編集のシート（docs/screens.md 6章の「固定費」）。下から出るモーダル（`app/recurring-edit.tsx`）の中身。登録も編集も
// 同じ。支出のシート（`ui/expense/ExpenseSheet.tsx`）と同じ作りで、金額・カテゴリ・支払う人・内容・負担の入力を並べ、毎月の日・
// 開始する月・終了する月を足したもの。
//
// 入力の状態・検査・リクエストの組み立ては、画面の外の `src/services/recurringForm.ts`（`npm test` で守る）にあり、この画面は、
// それを並べて、押されたものを渡すだけ。**負担額の計算も、プレビューも出さない**（CLAUDE.md）。
//
// - 登録の手順（`id` の使い回し、結果が分からない失敗のあとの `PATCH`、登録が済んだあとの失敗の扱い）は、画面の外の
//   `src/services/recurringCreate.ts`（`npm test` で守る。理由はそちらの先頭）。`id` は、最初に保存を押したときに1回だけ作り、
//   やり直しでも使い回す（固定費が2件になると、毎月2件ずつ支出が作られる）。結果が分からない失敗のあとに入力を直して送り直した
//   ときは、サーバーが保存済みの固定費をそのまま返すので、直した内容を `PATCH` で送る。この画面は、失敗した段階（`create`・
//   `create-update`）の文言を出すだけ。
// - 編集の保存は、変えたものだけを送る（`buildUpdatePlan`）。止まっている固定費の「再開する」は、入力の変更も一緒に送る（支払う人の
//   付け替えと再開が、1回の操作でないと、サーバーが断る）。**「止める」は、入力を変えているあいだは押せない**（変更を一緒に止める
//   のか、捨てるのかが、分からなくなる）。
// - 個別の負担（`category` 以外）の固定費を再開するときは、確認のダイアログに、送る負担の分け方を出す（止まっていたあいだに
//   メンバーが変わっているかもしれない。サーバーも、負担を送り直さないと再開を断る）。
// - 今月の分が作られないとき（応答の `thisMonthSkipped`）は、保存のあと、案内のダイアログを出してから閉じる（`skippedNotice`）。
// - シートを閉じるとき、入力が変わっていれば、破棄の確認を出す（✕・戻る操作のどちらも。保存・止める・削除のあとは出さない）。
//   通信の最中は、✕も戻る操作も効かない。止めているのは `beforeRemove` で、セッション切れの画面の除去（`Stack.Protected` の
//   ガードの切り替え）は通らない。招待URLによる参加確認への切り替えも同じ除去だが、通信の最中だけは遅らせる（`useHoldInviteSwap`）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { newId } from '../../platform/randomId.ts';
import { recurringService } from '../../platform/recurringService.ts';
import type { RecurringExpense, RecurringSaved, UpdateRecurringRequest } from '../../src/domain/recurring.ts';
import { pressKey, type ExpressionKey } from '../../src/services/amountExpression.ts';
import { formatMonth } from '../../src/services/dateFormat.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { initialOf, moneyFormatters } from '../../src/services/homeView.ts';
import {
  buildCreateRequest,
  buildRecurringContext,
  buildUpdatePlan,
  categoryOptions,
  checkDraft,
  endMonthRange,
  firstTargetMonth,
  initialDraft,
  payerOptions,
  resumeBlocker,
  setStartMonth,
  splitLocked,
  splitMemberIdsOf,
  splitMembers,
  splitRequestOf,
  startMonthRange,
  toggleCustomSplit,
  toggleEndMonth,
  type RecurringDraft,
  type RecurringFormContext,
} from '../../src/services/recurringForm.ts';
import { createRecurringCreator, RecurringCreateFailure } from '../../src/services/recurringCreate.ts';
import { saveRecurringErrorMessage, skippedNotice, type RecurringWriteAction } from '../../src/services/recurringMessage.ts';
import {
  CATEGORY_ARCHIVED_HELP,
  dayNote,
  describeSplit,
  pausedReasonText,
  statusOf,
} from '../../src/services/recurringView.ts';
import { AmountField } from '../expense/AmountField.tsx';
import { AmountKeypad } from '../expense/AmountKeypad.tsx';
import { Chips } from '../expense/Chips.tsx';
import { SplitEditor, type KeypadTarget } from '../expense/SplitEditor.tsx';
import { Avatar } from '../home/Avatar.tsx';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { useMounted } from '../useMounted.ts';
import { DayOfMonthGrid } from './DayOfMonthGrid.tsx';
import { MonthStepper } from './MonthStepper.tsx';

interface RecurringEditSheetProps {
  groupId: string;
  /** 編集する固定費のID（登録なら `null`） */
  recurringId: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; ctx: RecurringFormContext };

export function RecurringEditSheet({ groupId, recurringId }: RecurringEditSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    recurringService.load(groupId).then(
      (data) => {
        if (cancelled) return;
        const editing = recurringId === null ? null : (data.recurring.find((item) => item.id === recurringId) ?? null);
        // 編集の対象が見つからない（別のメンバーが削除した）
        if (recurringId !== null && editing === null) setLoad({ status: 'missing' });
        else setLoad({ status: 'ready', ctx: buildRecurringContext(data, editing) });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadHomeErrorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, recurringId, attempt]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (load.status === 'ready') return <RecurringEditor groupId={groupId} ctx={load.ctx} />;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.centered}>
        {load.status === 'loading' ? <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" /> : null}
        {load.status === 'error' ? (
          <>
            <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
              {load.message}
            </Text>
            <PrimaryButton label="もう一度" onPress={() => setAttempt((n) => n + 1)} />
          </>
        ) : null}
        {load.status === 'missing' ? (
          <Text style={[styles.message, { color: colors.textPrimary }]} accessibilityRole="alert">
            この固定費は見つかりません。別のメンバーが削除したかもしれません。
          </Text>
        ) : null}
        {load.status !== 'loading' ? <PrimaryButton label="閉じる" variant="secondary" onPress={close} /> : null}
      </View>
    </SafeAreaView>
  );
}

type Busy = 'save' | 'pause' | 'resume' | 'delete';

function RecurringEditor({ groupId, ctx }: { groupId: string; ctx: RecurringFormContext }) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const editing = ctx.editing;
  const [baseline] = useState(() => initialDraft(ctx));
  const [draft, setDraft] = useState<RecurringDraft>(baseline);
  // 金額を変えられない（負担の方法をアプリが変えられない固定費）ときは、キーパッドを出さない
  const [keypad, setKeypad] = useState<KeypadTarget>(splitLocked(ctx) ? null : { kind: 'amount' });
  const [busy, setBusy] = useState<Busy | null>(null);
  // 通信の最中は、招待URLによる参加確認への切り替えを遅らせる（`ui/inviteHold.ts`。外れると、登録の `id` が捨てられる）
  useHoldInviteSwap(busy !== null);
  // 外れたあと（セッション切れ・招待URLによる切り替え）に、完了した通信や、開いたままのダイアログのコールバックが、別の画面を戻さない
  // ようにする（`ui/useMounted.ts`）
  const mounted = useMounted();
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const leaving = useRef(false);
  // 登録の手順（`id`・結果が分からない失敗・登録が済んだか、を持つ）
  const [creator] = useState(() =>
    createRecurringCreator({
      create: (id, request) => recurringService.create(id, request),
      update: (id, request) => recurringService.update(id, request),
      newId,
    }),
  );
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 入力が変わっているときに閉じようとしたら、破棄の確認を出す（✕・戻る操作のどちらも）
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      // 通信の最中は、閉じない（閉じると、あとで完了したときに、閉じたシートから画面を戻してしまい、失敗したときは、何も
      // 表示されないまま、シートが消える）。✕は、最中は押せない
      if (running.current) {
        event.preventDefault();
        return;
      }
      if (!dirtyRef.current) return;
      event.preventDefault();
      // 登録は済んでいるのに、直した内容を反映できていないとき（`create-update`）は、そのことを伝える
      Alert.alert('入力内容を破棄しますか？', creator.created() ? '固定費は登録済みです。直した内容は、反映されません。' : undefined, [
        { text: '続ける', style: 'cancel' },
        {
          text: '破棄する',
          style: 'destructive',
          onPress: () => {
            if (mounted.current) navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
  }, [navigation]);

  const month = firstTargetMonth(draft.startMonth, ctx);
  const check = useMemo(() => checkDraft(draft, ctx), [draft, ctx]);
  const members = useMemo(() => splitMembers(ctx, month), [ctx, month]);
  const lockedSplit = splitLocked(ctx);
  const busyNow = busy !== null;
  const paused = editing !== null && editing.pausedAt !== null;
  const ended = editing !== null && statusOf(editing, ctx.currentMonth) === 'ended';
  const note = dayNote(draft.dayOfMonth ?? 0);

  function update(change: (current: RecurringDraft) => RecurringDraft) {
    setDraft(change);
    setError(null);
  }

  function pressKeypad(key: ExpressionKey) {
    if (keypad === null || lockedSplit) return;
    update((current) => {
      if (keypad.kind === 'amount') return { ...current, amount: pressKey(current.amount, key, ctx.minorUnit) };
      if (current.split === null) return current;
      const previous = current.split.amounts[keypad.memberId] ?? '';
      return {
        ...current,
        split: { ...current.split, amounts: { ...current.split.amounts, [keypad.memberId]: pressKey(previous, key, ctx.minorUnit) } },
      };
    });
  }

  function leave() {
    // 外れたあとは、画面を戻さない（そのとき開いている別の画面を戻してしまう）
    if (!mounted.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function memberName(memberId: string): string | undefined {
    return ctx.members.find((member) => member.id === memberId)?.displayName;
  }

  /**
   * 書き込みの実行。成功したら、今月の分が作られないときの案内（`skippedNotice`）を出してから閉じる。失敗したら、文言を出して、
   * 入力は消さない。`work` が `null` を返したとき（入力が検査に通らなかった）は、何も送らず、`blocker` を出す。
   */
  async function perform(
    action: RecurringWriteAction,
    busyKind: Busy,
    work: () => Promise<{ saved: RecurringSaved | null; change: 'create' | UpdateRecurringRequest | null } | null>,
    blocker: () => string | null,
  ) {
    if (running.current || !mounted.current) return;
    running.current = true;
    setBusy(busyKind);
    setError(null);
    try {
      const result = await work();
      if (result === null) {
        setError(blocker());
        return;
      }
      const notice = result.saved !== null && result.change !== null ? skippedNotice(result.change, result.saved) : null;
      if (notice === null) leave();
      else Alert.alert(notice.title, notice.body, [{ text: 'OK', onPress: leave }], { cancelable: false });
    } catch (e) {
      // 登録の手順の失敗は、どの段階か（`create`・`create-update`）で、文言を変える
      const failure = e instanceof RecurringCreateFailure ? { action: e.step, error: e.error } : { action, error: e };
      setError(
        saveRecurringErrorMessage(failure.error, failure.action, memberName, {
          payerMemberId: draft.payerMemberId,
          splitMemberIds: splitMemberIdsOf(draft, ctx),
        }),
      );
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function save() {
    void perform(
      editing === null ? 'create' : 'update',
      'save',
      async () => {
        if (editing === null) {
          const body = buildCreateRequest(draft, ctx);
          if (body === null) return null;
          return { saved: await creator.submit(groupId, body), change: 'create' };
        }
        const plan = buildUpdatePlan(draft, ctx);
        if (plan.kind === 'invalid') return null;
        // 何も変えていなければ、送らずに閉じる
        if (plan.kind === 'unchanged') return { saved: null, change: null };
        return { saved: await recurringService.update(editing.id, plan.request), change: plan.request };
      },
      () => check.blocker,
    );
  }

  /** 再開（入力の変更も一緒に送る）。個別の負担は、送る負担の分け方を確認ダイアログに出してから送る。 */
  function resume() {
    if (editing === null || running.current) return;
    const blocker = check.blocker ?? resumeBlocker(draft, ctx);
    if (blocker !== null) {
      setError(blocker);
      return;
    }
    const split = splitRequestOf(draft, ctx);
    const doResume = () => {
      // 外れたあとに、開いたままのダイアログから呼ばれたときは、何もしない（`perform` が見る）
      void perform(
        'resume',
        'resume',
        async () => {
          const plan = buildUpdatePlan(draft, ctx, { resume: true });
          if (plan.kind !== 'request') return null;
          return { saved: await recurringService.update(editing.id, plan.request), change: plan.request };
        },
        () => resumeBlocker(draft, ctx) ?? check.blocker,
      );
    };
    if (split === null || split.method === 'category') {
      doResume();
      return;
    }
    const { money } = moneyFormatters({ currencyCode: ctx.currencyCode, currencyMinorUnit: ctx.minorUnit });
    Alert.alert(
      '負担の分け方を確認してください',
      `${describeSplit(split, (id) => memberName(id) ?? '不明', money)}\n\n止まっているあいだにメンバーが変わっていないか、確かめてください。この内容で再開します。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'この内容で再開', onPress: doResume },
      ],
    );
  }

  function confirmPause() {
    if (editing === null || running.current) return;
    Alert.alert('この固定費を止めますか？', '止めているあいだは、毎月の登録をしません。あとで再開できます（止めていた月の分は、作られません）。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '止める',
        onPress: () =>
          void perform(
            'pause',
            'pause',
            async () => ({ saved: await recurringService.update(editing.id, { paused: true }), change: { paused: true } }),
            () => null,
          ),
      },
    ]);
  }

  function confirmRemove() {
    if (editing === null || running.current) return;
    Alert.alert(
      'この固定費を削除しますか？',
      '削除すると、元に戻せません。まだ一度も支出を作っていない固定費だけ、削除できます。作った固定費は、「止める」か、終了する月を決めてください。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: () =>
            void perform(
              'remove',
              'delete',
              async () => {
                await recurringService.remove(editing.id);
                return { saved: null, change: null };
              },
              () => null,
            ),
        },
      ],
    );
  }

  const title = editing === null ? '固定費を登録' : '固定費を編集';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* edge-to-edge（`android/gradle.properties` の `edgeToEdgeEnabled`）では、Androidも、キーボードでウィンドウが小さくならない
          （`adjustResize` が効かない）ので、iOSと同じく padding で避ける（`ExpenseSheet.tsx` と同じ） */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            hitSlop={8}
            disabled={busyNow}
            onPress={() => router.back()}
            style={styles.close}
          >
            <MaterialCommunityIcons name="close" size={26} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {editing !== null && paused && !ended ? (
            <View style={styles.banner}>
              <Text style={[styles.bannerTitle, { color: colors.error }]} accessibilityRole="alert">
                {pausedReasonText(editing)}
              </Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                下の「再開する」で、次の予定日から、また毎月登録します。止めていた月の分は、作られません。
              </Text>
            </View>
          ) : null}
          {editing !== null && ended ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {editing.endMonth === null ? '' : `${formatMonth(editing.endMonth)}で終了しています。`}
              終了する月を変えると、また登録されます。
            </Text>
          ) : null}
          {editing !== null && editing.categoryArchived && !ended ? (
            <View style={styles.banner}>
              <Text style={[styles.bannerTitle, { color: colors.error }]} accessibilityRole="alert">
                自動登録されていません
              </Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{CATEGORY_ARCHIVED_HELP}</Text>
            </View>
          ) : null}

          <AmountField
            label="金額"
            expression={draft.amount}
            currencyCode={ctx.currencyCode}
            minorUnit={ctx.minorUnit}
            active={keypad?.kind === 'amount'}
            onPress={
              busyNow || lockedSplit
                ? undefined
                : () => {
                    Keyboard.dismiss();
                    setKeypad({ kind: 'amount' });
                  }
            }
          />
          {lockedSplit ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              この固定費は、このアプリでは変えられない負担の方法を使っています。金額と負担の分け方は変えられません。
            </Text>
          ) : null}

          <Section label="カテゴリ">
            <Chips
              disabled={busyNow}
              options={categoryOptions(ctx).map((category) => ({
                key: category.id,
                label: category.name,
                note: category.archived ? '使わない設定のカテゴリ' : undefined,
                leading: (
                  <Ring>
                    <CategoryIcon icon={category.icon} color={category.color} size={22} />
                  </Ring>
                ),
              }))}
              selected={draft.categoryId}
              onSelect={(id) => update((current) => ({ ...current, categoryId: id }))}
            />
          </Section>

          <Section label="支払う人">
            <Chips
              disabled={busyNow}
              options={payerOptions(ctx, month).map((member) => ({
                key: member.id,
                label: member.displayName,
                leading: (
                  <Ring>
                    <Avatar initial={initialOf(member.displayName)} color={member.color} size={22} />
                  </Ring>
                ),
              }))}
              selected={draft.payerMemberId}
              onSelect={(id) => update((current) => ({ ...current, payerMemberId: id }))}
            />
          </Section>

          <Section label="毎月の日">
            <DayOfMonthGrid
              value={draft.dayOfMonth}
              disabled={busyNow}
              onSelect={(day) => {
                // 日・月を選ぶあいだは、キーパッドを隠す（下の入力欄・ボタンまで、画面を使えるように）。金額をタップすると、戻る
                Keyboard.dismiss();
                setKeypad(null);
                update((current) => ({ ...current, dayOfMonth: day }));
              }}
            />
            {note !== null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{note}</Text> : null}
          </Section>

          <Section label="内容（任意）">
            <TextInput
              accessibilityLabel="内容"
              value={draft.description}
              onChangeText={(text) => update((current) => ({ ...current, description: text }))}
              // OSのキーボードで入れるあいだは、キーパッドを隠す。金額をタップすると、戻る
              onFocus={() => setKeypad(null)}
              editable={!busyNow}
              placeholder="家賃、インターネット など"
              placeholderTextColor={colors.textSecondary}
              maxLength={120}
              returnKeyType="done"
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
            />
          </Section>

          <Section label="開始する月">
            <MonthStepper
              label="開始する月"
              month={draft.startMonth}
              range={startMonthRange(ctx)}
              disabled={busyNow}
              onChange={(next) => {
                setKeypad(null);
                update((current) => setStartMonth(current, next, ctx));
              }}
            />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              この月から、毎月の予定日に、自動で支出として登録します。今月の予定日をすぎているときは、今月の分は作られません。
              {editing === null ? '' : '変更は、まだ作っていない月の分から反映されます。登録済みの支出は変わりません。'}
            </Text>
          </Section>

          <View style={styles.splitBlock}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="終了する月を決める"
              accessibilityState={{ checked: draft.endMonth !== null, disabled: busyNow }}
              disabled={busyNow}
              onPress={() => {
                setKeypad(null);
                update((current) => toggleEndMonth(current, ctx));
              }}
              style={styles.checkRow}
            >
              <MaterialCommunityIcons
                name={draft.endMonth !== null ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={26}
                color={draft.endMonth !== null ? colors.accent : colors.textSecondary}
              />
              <Text style={[styles.checkLabel, { color: colors.textPrimary }]}>終了する月を決める</Text>
            </Pressable>
            {draft.endMonth !== null ? (
              <>
                <MonthStepper
                  label="終了する月"
                  month={draft.endMonth}
                  range={endMonthRange(draft)}
                  disabled={busyNow}
                  onChange={(next) => {
                    setKeypad(null);
                    update((current) => ({ ...current, endMonth: next }));
                  }}
                />
                <Text style={[styles.hint, { color: colors.textSecondary }]}>この月の分まで登録します。</Text>
              </>
            ) : (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>決めなければ、止めるまで毎月登録します。</Text>
            )}
          </View>

          {lockedSplit ? null : (
            <View style={styles.splitBlock}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="この固定費だけ負担を変える"
                accessibilityState={{ checked: draft.split !== null, disabled: busyNow }}
                disabled={busyNow}
                onPress={() => {
                  update((current) => toggleCustomSplit(current, ctx));
                  setKeypad({ kind: 'amount' });
                }}
                style={styles.checkRow}
              >
                <MaterialCommunityIcons
                  name={draft.split !== null ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={26}
                  color={draft.split !== null ? colors.accent : colors.textSecondary}
                />
                <Text style={[styles.checkLabel, { color: colors.textPrimary }]}>この固定費だけ負担を変える</Text>
              </Pressable>
              {draft.split === null ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>カテゴリの割合で分けます。</Text>
              ) : (
                <SplitEditor
                  split={draft.split}
                  members={members}
                  currencyCode={ctx.currencyCode}
                  minorUnit={ctx.minorUnit}
                  keypadTarget={keypad}
                  disabled={busyNow}
                  onChange={(split) => update((current) => ({ ...current, split }))}
                  onKeypadTarget={setKeypad}
                />
              )}
            </View>
          )}

          {editing !== null ? (
            <View style={styles.actions}>
              {paused ? (
                <PrimaryButton
                  label={dirty ? '保存して再開' : '再開する'}
                  variant="secondary"
                  busy={busy === 'resume'}
                  disabled={busyNow}
                  onPress={resume}
                />
              ) : (
                <>
                  <PrimaryButton label="止める" variant="secondary" busy={busy === 'pause'} disabled={busyNow || dirty} onPress={confirmPause} />
                  {dirty ? (
                    <Text style={[styles.hint, { color: colors.textSecondary }]}>変更を保存してから、止めてください。</Text>
                  ) : null}
                </>
              )}
              <PrimaryButton label="この固定費を削除" variant="destructive" busy={busy === 'delete'} disabled={busyNow} onPress={confirmRemove} />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.bottom, { borderColor: colors.border, backgroundColor: colors.background }]}>
          {error !== null ? (
            <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : check.blocker !== null ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
              {check.blocker}
            </Text>
          ) : null}
          {keypad !== null && !busyNow ? <AmountKeypad minorUnit={ctx.minorUnit} onKey={pressKeypad} /> : null}
          <PrimaryButton
            label={paused ? `${check.saveLabel}（止めたまま）` : check.saveLabel}
            busy={busy === 'save'}
            disabled={!check.canSave || busyNow}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** チップの中のアイコンを、背景色（選んだときのピンク）と同じ色のアイコンでも見分けられるよう、白い縁で囲む。 */
function Ring({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <View style={[styles.ring, { backgroundColor: colors.background }]}>{children}</View>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 18, fontWeight: '700' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 16 },
  banner: { gap: 4 },
  bannerTitle: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  section: { gap: 8 },
  ring: { padding: 2, borderRadius: 999 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 17 },
  hint: { fontSize: 13, lineHeight: 18 },
  splitBlock: { gap: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkLabel: { fontSize: 16, fontWeight: '600' },
  actions: { gap: 12, marginTop: 8 },
  bottom: { gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
