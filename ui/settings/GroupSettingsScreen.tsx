// グループの設定（設定の中。docs/screens.md 6章の「グループの設定」）。グループ名・通貨と、自分の表示名・色。
//
// 内容は、**開くときに読み直した**もの（`groupService.getGroup`）で出す。入力の検査・保存の組み立ては、画面の外の
// `src/services/groupSettingsForm.ts`・`groupSettingsSave.ts`（`npm test` で守る）。この画面は、入力欄を並べて、押されたものを渡すだけ。
//
// - 変えられるかは、サーバーの値で決める（`leaveEffective`・`currencyLocked`）。アプリは、規則を書き写さない。脱退が確定した人は、
//   グループ名・通貨を変えられない（自分の表示名・色は変えられる）。
// - 保存は、変えたものだけを送る（グループ名・通貨と、自分の表示名・色の、2つの呼び出し）。途中で失敗したら、済んだほうは保存済みとして
//   残し、やり直しでは残りだけを送る。断られて、変えられるものが変わった（脱退が確定した・通貨が固定された）と分かったときは、読み直して、
//   入力を載せ直す（`rebase`）。競合・通信の失敗は、読み直さず、もう一度押してもらう（同じ内容の送り直しは、結果が変わらない）。
// - 通信の最中は、戻る矢印・戻る操作が効かない。変えた入力があるときの戻る操作は、破棄の確認を出す。止めているのは `beforeRemove` で、
//   セッション切れの画面の除去（`Stack.Protected` のガードの切り替え）は通らない（`ExpenseSheet.tsx` と同じ）。招待URLによる参加確認への
//   切り替えも同じ除去だが、通信の最中だけは遅らせる（`useHoldInviteSwap`）。
// - グループ名を変えたら、所属グループの一覧を読み直す（`reloadGroups`。ホームの上部・グループの切り替えに出る名前が、古いままにならない）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupService } from '../../platform/groupService.ts';
import { CURRENCIES, MEMBER_COLORS } from '../../src/domain/group.ts';
import {
  checkSettings,
  contextOf,
  isDirty,
  rebase,
  type GroupSettingsContext,
  type GroupSettingsDraft,
  type GroupSettingsErrors,
} from '../../src/services/groupSettingsForm.ts';
import { discardNote, saveErrorMessage, saveLostGroup, shouldReloadAfterSave } from '../../src/services/groupSettingsMessage.ts';
import { saveSettings } from '../../src/services/groupSettingsSave.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import { initialOf } from '../../src/services/homeView.ts';
import { categoryColorLabel } from '../../src/theme/categoryIcons.ts';
import { paletteColor } from '../../src/theme/palette.ts';
import { Chips } from '../expense/Chips.tsx';
import { reloadGroups } from '../groupList.ts';
import { Avatar } from '../home/Avatar.tsx';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { TextField } from '../TextField.tsx';
import { useColors } from '../useColors.ts';
import { useMounted } from '../useMounted.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; context: GroupSettingsContext; draft: GroupSettingsDraft };

const SWATCH_SIZE = 44;

export function GroupSettingsScreen({ groupId }: { groupId: string }) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<GroupSettingsErrors>({});
  // 保存の最中は、招待URLによる参加確認への切り替えを遅らせる（`ui/inviteHold.ts`）
  useHoldInviteSwap(busy);
  // 外れたあと（セッション切れ・招待URLによる切り替え）に、完了した通信や、開いたままのダイアログのコールバックが、別の画面を戻さない
  // ようにする（`ui/useMounted.ts`）
  const mounted = useMounted();
  const running = useRef(false);
  const leaving = useRef(false);
  // グループ名・通貨の保存が済んだか（そのあとの破棄の確認の文言が、事実と合うように）
  const groupSaved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    groupService.getGroup(groupId).then(
      (group) => {
        if (cancelled) return;
        const context = contextOf(group);
        if (context === null) {
          setLoad({ status: 'error', message: 'グループの情報を確認できませんでした。もう一度お試しください。' });
          return;
        }
        setLoad({ status: 'ready', context, draft: context.baseline });
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadHomeErrorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, attempt]);

  const dirty = load.status === 'ready' && isDirty(load.draft, load.context);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // 通信の最中は閉じない。変えた入力があるときは、破棄の確認を出す
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      if (running.current) {
        event.preventDefault();
        return;
      }
      if (!dirtyRef.current) return;
      event.preventDefault();
      Alert.alert('変更を破棄しますか？', discardNote(groupSaved.current), [
        { text: '編集を続ける', style: 'cancel' },
        {
          text: '破棄する',
          style: 'destructive',
          onPress: () => {
            if (!mounted.current) return;
            leaving.current = true;
            navigation.dispatch(event.data.action);
          },
        },
      ]);
    });
  }, [navigation, mounted]);

  // iOSの端のスワイプで戻る操作は、ネイティブ側で先に実行され、`beforeRemove` で止めても戻ってしまうことがある。通信の最中と、
  // 変えた入力があるあいだは、スワイプを無効にする（戻る矢印・Androidの戻る操作は、上で止める・確認する）
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !busy && !dirty });
  }, [navigation, busy, dirty]);

  // 失敗を、読み上げにも伝える（Androidは、`accessibilityLiveRegion` が伝える。iOSは伝えないので、ここで読み上げる）
  useEffect(() => {
    if (Platform.OS !== 'ios' || error === null) return;
    AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  function leave() {
    // 外れたあとは、画面を戻さない（そのとき開いている別の画面を戻してしまう）
    if (!mounted.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  // 戻る矢印は、`beforeRemove` の止めと確認を通す（`leaving` を立てない）
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  function update(next: GroupSettingsDraft) {
    setLoad((current) => (current.status === 'ready' ? { ...current, draft: next } : current));
    // 入力を直したら、前の失敗の文言は消す（直したあとの保存の結果ではないため）
    setError(null);
    setFieldErrors({});
  }

  async function save() {
    if (load.status !== 'ready' || running.current || !mounted.current) return;
    const { context, draft } = load;
    const check = checkSettings(draft, context);
    if (!check.ok) {
      setFieldErrors(check.errors);
      setError(null);
      return;
    }
    const { plan } = check;
    if (plan.group === null && plan.me === null) return;
    setFieldErrors({});
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await saveSettings(groupService, groupId, plan, context);
      if (result.ok) {
        // グループ名が変わったら、所属グループの一覧を読み直す（ホームの上部の名前など）
        if (plan.group?.name !== undefined) reloadGroups();
        leave();
        return;
      }
      groupSaved.current = groupSaved.current || result.saved;
      // 済んだ段階は、基準に取り込む（やり直しで、残りだけを送る）
      if (result.saved && plan.group?.name !== undefined) reloadGroups();
      if (saveLostGroup(result.error)) reloadGroups();
      const message = saveErrorMessage(result.error, result.step, result.saved);
      if (shouldReloadAfterSave(result.error)) {
        await reloadAfterRejection(result.context, draft, message);
      } else {
        setLoad((current) => (current.status === 'ready' ? { ...current, context: result.context } : current));
        setError(message);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  /** 断られて、変えられるものが変わったと分かったとき。読み直して、いまの入力を載せ直す。読み直せなければ、入力はそのまま。 */
  async function reloadAfterRejection(context: GroupSettingsContext, draft: GroupSettingsDraft, message: string) {
    try {
      const group = await groupService.getGroup(groupId);
      const fresh = contextOf(group);
      if (fresh === null) {
        setLoad((current) => (current.status === 'ready' ? { ...current, context } : current));
      } else {
        setLoad({ status: 'ready', context: fresh, draft: rebase(draft, context, fresh) });
      }
    } catch {
      setLoad((current) => (current.status === 'ready' ? { ...current, context } : current));
    }
    setError(message);
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          グループの設定
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
          <PrimaryButton label="もう一度" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                グループ
              </Text>
              <TextField
                label="グループ名"
                value={load.draft.name}
                onChangeText={(name) => update({ ...load.draft, name })}
                error={fieldErrors.name}
                editable={!busy && load.context.access.canEditGroup}
                returnKeyType="done"
              />
              {!load.context.access.canEditGroup ? (
                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  脱退が確定したため、グループ名と通貨は変えられません。
                </Text>
              ) : null}

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>通貨</Text>
                <Chips
                  wrap
                  options={CURRENCIES.map((currency) => ({ key: currency.code, label: currency.name }))}
                  selected={load.draft.currencyCode}
                  onSelect={(currencyCode) => update({ ...load.draft, currencyCode })}
                  disabled={busy || !load.context.access.canEditCurrency}
                />
                {fieldErrors.currencyCode ? (
                  <Text style={[styles.note, { color: colors.error }]} accessibilityRole="alert">
                    {fieldErrors.currencyCode}
                  </Text>
                ) : load.context.access.canEditGroup ? (
                  <Text style={[styles.note, { color: colors.textSecondary }]}>
                    {load.context.access.currencyLocked
                      ? '支出・固定費・上限額つきの負担・締めた月のどれかがあるあいだは、通貨を変えられません。'
                      : '支出などを登録したあとは、通貨を変えられません。'}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                自分（このグループでの設定）
              </Text>
              <TextField
                label="自分の表示名"
                value={load.draft.displayName}
                onChangeText={(displayName) => update({ ...load.draft, displayName })}
                error={fieldErrors.displayName}
                editable={!busy}
                returnKeyType="done"
              />

              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>自分の色</Text>
                <View style={styles.colorRow}>
                  <Avatar initial={initialOf(load.draft.displayName)} color={load.draft.color} size={SWATCH_SIZE} />
                  <View style={styles.swatches} accessibilityRole="radiogroup">
                    {MEMBER_COLORS.map((key) => {
                      const selected = key === load.draft.color;
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="radio"
                          accessibilityLabel={categoryColorLabel(key)}
                          accessibilityState={{ selected, disabled: busy }}
                          disabled={busy}
                          onPress={() => update({ ...load.draft, color: key })}
                          style={[
                            styles.swatch,
                            { backgroundColor: paletteColor(key), borderColor: selected ? colors.textPrimary : 'transparent' },
                            busy && styles.dimmed,
                          ]}
                        >
                          {selected ? <MaterialCommunityIcons name="check" size={22} color="#17171A" /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  メンバーのアイコンの色です。他のメンバーと同じ色も選べます。
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* ボタンは、画面の下に固定する（キーボードを出したままでも押せる）。失敗の文言は、その上に出す（ログイン・グループ作成と同じ理由） */}
          <View style={styles.footer}>
            {error !== null ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <PrimaryButton label="保存" busy={busy} disabled={!dirty} onPress={() => void save()} />
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 28 },
  block: { gap: 14 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 19 },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  swatches: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8, gap: 12 },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  dimmed: { opacity: 0.5 },
});
