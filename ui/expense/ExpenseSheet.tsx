// 支出の登録・編集のシート（docs/screens.md 4章）。下から出るモーダル（`app/expense.tsx`）の中身。登録も編集も同じ。
// 締めた月の支出は、読み取り専用で開く（キーパッド・保存・削除は出さない）。
//
// 入力の状態・検査・リクエストの組み立ては、画面の外の `src/services/expenseForm.ts` にあり（`npm test` で守る）、この画面は、
// それを並べて、押されたものを渡すだけ。
//
// - 登録の識別子（`requestId`）は、最初に保存を押したときに1回だけ作り、やり直しでも同じ値を送る（通信が切れて結果が分からない
//   とき、支出が2件にならない。docs/backend-design.md 9章の「二重送信」）。副作用として、結果が分からない失敗のあとで入力を
//   直して送り直すと、最初の登録が済んでいた場合は、直した内容は反映されない（保存済みの支出が返る）。二重に登録されるより、
//   よいとした（反映されなかった内容は、ホームの一覧から編集できる）。
// - シートを閉じるとき、入力が変わっていれば、破棄の確認を出す（✕・戻る操作のどちらも。保存・削除のあとは出さない）。
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

import { expenseNotice, expenseService } from '../../platform/expenseService.ts';
import { loadLastCategory, saveLastCategory } from '../../platform/lastCategory.ts';
import { newId } from '../../platform/randomId.ts';
import { ExpenseRejectedError } from '../../src/repositories/expenseRepository.ts';
import { pressKey, type ExpressionKey } from '../../src/services/amountExpression.ts';
import { formatExpenseDate, formatMonthShort } from '../../src/services/dateFormat.ts';
import { saveExpenseErrorMessage } from '../../src/services/expenseMessage.ts';
import {
  buildCreateRequest,
  buildFormContext,
  buildUpdatePlan,
  categoryOptions,
  checkDraft,
  initialDraft,
  monthChoices,
  monthNote,
  payerOptions,
  splitLocked,
  splitMembers,
  splitMemberIdsOf,
  syncForMonth,
  targetMonthOf,
  toggleCustomSplit,
  type ExpenseDraft,
  type ExpenseFormContext,
} from '../../src/services/expenseForm.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { initialOf } from '../../src/services/homeView.ts';
import { formatMonth } from '../../src/services/dateFormat.ts';
import { Avatar } from '../home/Avatar.tsx';
import { CategoryIcon } from '../home/CategoryIcon.tsx';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { useMounted } from '../useMounted.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { AmountField } from './AmountField.tsx';
import { AmountKeypad } from './AmountKeypad.tsx';
import { CalendarModal } from './CalendarModal.tsx';
import { Chips } from './Chips.tsx';
import { ReadOnlyExpense } from './ReadOnlyExpense.tsx';
import { SplitEditor, type KeypadTarget } from './SplitEditor.tsx';

interface ExpenseSheetProps {
  groupId: string;
  /** 編集する支出のID（登録なら `null`） */
  expenseId: string | null;
  /** 編集する支出の登録した月（編集のときだけ） */
  month: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; ctx: ExpenseFormContext; lastCategoryId: string | null };

export function ExpenseSheet({ groupId, expenseId, month }: ExpenseSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    const target = expenseId !== null && month !== null ? { id: expenseId, month } : null;
    Promise.all([expenseService.load(groupId, target), loadLastCategory(groupId)]).then(
      ([data, lastCategoryId]) => {
        if (cancelled) return;
        // 編集の対象が見つからない（別のメンバーが削除した）
        if (target !== null && data.expense === null) setLoad({ status: 'missing' });
        else setLoad({ status: 'ready', ctx: buildFormContext(data, new Date()), lastCategoryId });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadHomeErrorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, expenseId, month, attempt]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (load.status === 'ready') {
    return <ExpenseEditor groupId={groupId} ctx={load.ctx} lastCategoryId={load.lastCategoryId} />;
  }
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
            この支出は見つかりません。別のメンバーが削除したかもしれません。
          </Text>
        ) : null}
        {load.status !== 'loading' ? <PrimaryButton label="閉じる" variant="secondary" onPress={close} /> : null}
      </View>
    </SafeAreaView>
  );
}

interface ExpenseEditorProps {
  groupId: string;
  ctx: ExpenseFormContext;
  lastCategoryId: string | null;
}

function ExpenseEditor({ groupId, ctx, lastCategoryId }: ExpenseEditorProps) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const editing = ctx.editing;
  const [baseline] = useState(() => initialDraft(ctx, lastCategoryId));
  const [draft, setDraft] = useState<ExpenseDraft>(baseline);
  // 金額を変えられない（締めた月、負担の方法をアプリが変えられない支出）ときは、キーパッドを出さない
  const [keypad, setKeypad] = useState<KeypadTarget>(ctx.readOnly || splitLocked(ctx) ? null : { kind: 'amount' });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  // 保存・削除の最中は、招待URLによる参加確認への切り替えを遅らせる（`ui/inviteHold.ts`。外れると、保存の `id` が捨てられる）
  useHoldInviteSwap(busy !== null);
  // 外れたあと（セッション切れ・招待URLによる切り替え）に、完了した通信や、開いたままのダイアログのコールバックが、別の画面を戻さない
  // ようにする（`ui/useMounted.ts`）
  const mounted = useMounted();
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const leaving = useRef(false);
  const requestId = useRef<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // 入力が変わっているときに閉じようとしたら、破棄の確認を出す（✕・戻る操作のどちらも）
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      // 保存・削除の通信の最中は、閉じない（閉じると、あとで完了したときに、閉じたシートから画面を戻してしまい、
      // 失敗したときは、何も表示されないまま、シートが消える）。✕は、最中は押せない
      if (running.current) {
        event.preventDefault();
        return;
      }
      if (!dirtyRef.current) return;
      event.preventDefault();
      Alert.alert('入力内容を破棄しますか？', undefined, [
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

  const month = targetMonthOf(draft, ctx);
  const check = useMemo(() => checkDraft(draft, ctx), [draft, ctx]);
  const members = useMemo(() => splitMembers(ctx, month), [ctx, month]);
  const lockedSplit = splitLocked(ctx);
  // 選択肢は、登録できる月。いま選んでいる月が、その外にあるとき（「締められました」のあとに選んだ次の月）も、並べる
  const choices = useMemo(() => {
    const base = monthChoices(ctx);
    return month === null || base.includes(month) ? base : [...base, month].sort();
  }, [ctx, month]);
  const note = monthNote(draft, ctx);
  const busyNow = busy !== null;

  function update(change: (current: ExpenseDraft) => ExpenseDraft) {
    setDraft(change);
    setError(null);
  }

  function pressKeypad(key: ExpressionKey) {
    if (keypad === null || ctx.readOnly || lockedSplit) return;
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

  /** 保存の実行。`monthOverride` は、「締められました。次の月に登録しますか？」に応じたときの登録先。 */
  async function save(monthOverride?: string) {
    // 外れたあとに、開いたままのダイアログ（「登録しますか？」）から呼ばれたときは、何もしない
    if (running.current || ctx.readOnly || !mounted.current) return;
    const target = monthOverride === undefined ? draft : syncForMonth({ ...draft, monthChoice: monthOverride }, ctx);
    const targetMonth = targetMonthOf(target, ctx);
    running.current = true;
    setBusy('save');
    setError(null);
    try {
      // ホームで見ている月と違う月に保存したことを、ホームに知らせる月（登録、または編集で月を移したとき）
      let savedMonth: string | null = null;
      if (editing === null) {
        const request = buildCreateRequest(target, ctx, (requestId.current ??= newId()));
        if (request === null) {
          setError(checkDraft(target, ctx).blocker);
          return;
        }
        await expenseService.create(groupId, request);
        savedMonth = request.targetMonth;
        if (target.categoryId !== null) void saveLastCategory(groupId, target.categoryId);
      } else {
        const plan = buildUpdatePlan(target, ctx);
        if (plan.kind === 'invalid') {
          setError(checkDraft(target, ctx).blocker);
          return;
        }
        // 何も変えていなければ、送らずに閉じる
        if (plan.kind === 'request') {
          await expenseService.update(editing.id, plan.request);
          savedMonth = plan.request.targetMonth ?? null;
        }
      }
      if (savedMonth !== null) expenseNotice.post(savedMonth);
      leave();
    } catch (e) {
      // 開いているあいだに、登録先の月が締められた（月の選択肢は、開いたときに読んだ月の一覧から出しているので、締め以外で、
      // 登録できなくなることは無い）。登録できる範囲（`from`〜`to`）のうち、選んでいた月に近いほうへ登録するか聞く。
      // 範囲より前の月（締められた月）なら、範囲の先頭（`from`）。入力は消さない
      const proposal = e instanceof ExpenseRejectedError ? proposedMonth(e, targetMonth) : null;
      if (editing === null && e instanceof ExpenseRejectedError && e.reason === 'month_not_registerable' && proposal !== null) {
        Alert.alert(
          `${targetMonth === null ? 'この月' : formatMonthShort(targetMonth)}は締められました。`,
          `${formatMonthShort(proposal)}分として登録しますか？`,
          [
            { text: 'キャンセル', style: 'cancel' },
            {
              text: '登録する',
              onPress: () => {
                // 画面の選択にも反映する（再送が失敗しても、選んだ月と送った月がずれない）
                update((current) => syncForMonth({ ...current, monthChoice: proposal }, ctx));
                void save(proposal);
              },
            },
          ],
        );
      } else {
        setError(
          saveExpenseErrorMessage(e, editing === null ? 'create' : 'update', memberName, {
            payerMemberId: target.payerMemberId,
            splitMemberIds: splitMemberIdsOf(target, ctx),
          }),
        );
      }
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function memberName(memberId: string): string | undefined {
    return ctx.members.find((member) => member.id === memberId)?.displayName;
  }

  function confirmRemove() {
    if (editing === null || running.current) return;
    Alert.alert('この支出を削除しますか？', '削除すると、元に戻せません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => void remove(editing.id) },
    ]);
  }

  async function remove(id: string) {
    // 外れたあとに、開いたままのダイアログ（削除の確認）から呼ばれたときは、何もしない（見えない画面の支出を、消さない）
    if (running.current || !mounted.current) return;
    running.current = true;
    setBusy('delete');
    setError(null);
    try {
      await expenseService.remove(id);
      leave();
    } catch (e) {
      setError(saveExpenseErrorMessage(e, 'remove', memberName));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  const title = ctx.readOnly ? '支出（締め済み）' : editing === null ? '支出を登録' : '支出を編集';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* edge-to-edge（`android/gradle.properties` の `edgeToEdgeEnabled`）では、Androidも、キーボードでウィンドウが小さくならない
          （`adjustResize` が効かない。エミュレータで、保存ボタンがキーボードの下に隠れることを確かめた）ので、iOSと同じく padding で避ける */}
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
          {ctx.readOnly ? (
            <ReadOnlyExpense ctx={ctx} />
          ) : (
            <>
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
                  この支出は、このアプリでは変えられない負担の方法を使っています。金額と負担の分け方は変えられません。
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

              <Section label="支払った人">
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

              <Section label="日付">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`日付、${formatExpenseDate(draft.date)}。変更する`}
                  disabled={busyNow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCalendarOpen(true);
                  }}
                  style={[styles.dateButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <MaterialCommunityIcons name="calendar-month-outline" size={22} color={colors.textSecondary} />
                  <Text style={[styles.dateText, { color: colors.textPrimary }]}>{formatExpenseDate(draft.date)}</Text>
                </Pressable>
              </Section>

              <Section label="内容（任意）">
                <TextInput
                  accessibilityLabel="内容"
                  value={draft.description}
                  onChangeText={(text) => update((current) => ({ ...current, description: text }))}
                  // OSのキーボードで入れるあいだは、キーパッドを隠す。金額をタップすると、戻る
                  onFocus={() => setKeypad(null)}
                  editable={!busyNow}
                  placeholder="スーパー、ガス代 など"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={120}
                  returnKeyType="done"
                  style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
                />
              </Section>

              {choices.length >= 2 ? (
                <Section label="登録する月">
                  <Chips
                    disabled={busyNow}
                    options={choices.map((choice) => ({ key: choice, label: `${formatMonthShort(choice)}分`, note: formatMonth(choice) }))}
                    selected={month}
                    onSelect={(choice) => update((current) => syncForMonth({ ...current, monthChoice: choice }, ctx))}
                  />
                </Section>
              ) : null}
              {note !== null ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{note}</Text> : null}

              {lockedSplit ? null : (
                <View style={styles.splitBlock}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel="この支出だけ負担を変える"
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
                    <Text style={[styles.checkLabel, { color: colors.textPrimary }]}>この支出だけ負担を変える</Text>
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
                <View style={styles.remove}>
                  <PrimaryButton label="この支出を削除" variant="secondary" busy={busy === 'delete'} disabled={busyNow} onPress={confirmRemove} />
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {ctx.readOnly ? null : (
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
            <PrimaryButton label={check.saveLabel} busy={busy === 'save'} disabled={!check.canSave || busyNow} onPress={() => void save()} />
          </View>
        )}
      </KeyboardAvoidingView>

      <CalendarModal
        visible={calendarOpen}
        value={draft.date}
        today={ctx.today}
        onSelect={(date) => update((current) => syncForMonth({ ...current, date }, ctx))}
        onClose={() => setCalendarOpen(false)}
      />
    </SafeAreaView>
  );
}

/** チップの中のアイコンを、背景色（選んだときのピンク）と同じ色のアイコンでも見分けられるよう、白い縁で囲む。 */
function Ring({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return <View style={[styles.ring, { backgroundColor: colors.background }]}>{children}</View>;
}

/**
 * 「登録先の月が登録できなくなった」とき、聞く先の月。登録できる範囲（`from`〜`to`）のうち、選んでいた月より後なら範囲の先頭
 * （`from`。選んでいた月がちょうど締められたとき、その次の月）、そうでなければ範囲の末尾（`to`）。選んでいた月と同じなら提案しない。
 */
function proposedMonth(error: ExpenseRejectedError, target: string | null): string | null {
  const proposal = target !== null && error.from !== null && target < error.from ? error.from : error.to;
  return proposal !== null && proposal !== target ? proposal : null;
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
  section: { gap: 8 },
  ring: { padding: 2, borderRadius: 999 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dateText: { fontSize: 17, fontWeight: '600' },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 17 },
  hint: { fontSize: 13, lineHeight: 18 },
  splitBlock: { gap: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkLabel: { fontSize: 16, fontWeight: '600' },
  remove: { marginTop: 8 },
  bottom: { gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
