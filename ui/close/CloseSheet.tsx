// 月を締める前の確認のシート（docs/screens.md 5章の「締めの確認」）。下から出るモーダル（`app/close.tsx`）の中身。
//
// 確認の内容は、**開くときに読み直した集計**で出す（ホームが読んだ古い集計ではなく。`settlementService.loadClose`）。出す内容の
// 組み立ては、画面の外の `src/services/closeView.ts`（`npm test` で守る）。この画面は、それを並べて、押されたものを渡すだけ。
// 精算の計算も、締められるかの判断もしない（サーバーの答えに従う）。
//
// - 締めたら、シートを閉じる。ホームは、戻ったときに取り直す（`HomeScreen` の `useFocusEffect`）ので、締めた結果は、そちらで見る。
// - 締めるのは、やり直さない。断られたとき（他のメンバーが先に締めた・支出を変えた、など）は、文言を出して、確認の内容を読み直す
//   （自動で締め直さない。内容を見て、もう一度押してもらう）。通信の失敗は、読み直さない（同じ失敗になりうる）。
// - 通信の最中は、✕も、戻る操作も効かない（閉じると、完了したあとに、閉じたシートから画面を戻してしまう）。止めているのは
//   `beforeRemove` で、セッション切れの画面の除去（`Stack.Protected` のガードの切り替え）は通らない（`ExpenseSheet.tsx` と同じ）。
//   招待URLによる参加確認への切り替えも、同じ除去だが、通信の最中だけは遅らせる（`useHoldInviteSwap`。`ui/inviteHold.ts`）。
// - 最後の1人の脱退で、締めずにグループごと消えたとき（サーバーが `groupDeleted` を返す）は、そのことを案内して閉じる。
//   所属グループの一覧は、読み直す（`reloadGroups`。`ui/GroupGate.tsx` が、別のグループか、グループの作成へ回す）。
// - **締めるとグループが消える月**（集計の `close.deletesGroup`。サーバーの値で、最後の1人かの規則は書き写さない）は、削除の警告を
//   出し、ボタンの文言を「グループを削除して脱退」にして、押したあとに確認ダイアログを挟む（取り消せないため）。送金・締めた後の
//   制限は出さない（月は締められず、送金も作られない）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { settlementService } from '../../platform/settlementService.ts';
import { buildCloseConfirm } from '../../src/services/closeView.ts';
import { formatMonthShort } from '../../src/services/dateFormat.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import {
  GROUP_DELETED_MESSAGE,
  settlementErrorMessage,
  shouldReloadAfter,
  withReloadFailure,
} from '../../src/services/settlementMessage.ts';
import type { CloseFormData } from '../../src/services/settlementService.ts';
import { reloadGroups } from '../groupList.ts';
import { TransferRow } from '../home/TransferRow.tsx';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { useMounted } from '../useMounted.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';

interface CloseSheetProps {
  groupId: string;
  /** 締める月（`YYYY-MM`） */
  month: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CloseFormData };

export function CloseSheet({ groupId, month }: CloseSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  // 締めている通信の最中は、招待URLによる参加確認への切り替えを遅らせる（`ui/inviteHold.ts`）
  useHoldInviteSwap(busy);
  // 外れたあと（セッション切れ・招待URLによる切り替え）に、完了した通信が、別の画面を戻さないようにする（`ui/useMounted.ts`）
  const mounted = useMounted();
  const [error, setError] = useState<string | null>(null);
  const [groupDeleted, setGroupDeleted] = useState(false);
  const running = useRef(false);
  const leaving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    settlementService.loadClose(groupId, month).then(
      (data) => {
        if (!cancelled) setLoad({ status: 'ready', data });
      },
      (e: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadHomeErrorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groupId, month, attempt]);

  // 締めている通信の最中は、閉じない（上のコメント）
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (leaving.current) return;
      if (running.current) event.preventDefault();
    });
  }, [navigation]);

  const model = useMemo(() => (load.status === 'ready' ? buildCloseConfirm(load.data) : null), [load]);

  function leave() {
    // 外れたあとは、画面を戻さない（そのとき開いている別の画面を戻してしまう）
    if (!mounted.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function close() {
    if (running.current || model === null || model.state !== 'ready') return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      // グループが消えることを警告した確認（`deleteConfirm`）を出したときだけ、確認の申告を付ける。確認を出したあとで状態が変わり、
      // 警告の無い確認のまま消えることになったときは、サーバーが断る（読み直して、警告を出し直す）
      const result = await settlementService.close(groupId, month, model.deletesGroup);
      if (result.kind === 'group-deleted') {
        setGroupDeleted(true);
        // 所属グループの一覧を読み直す（このグループは、もう無い）。シートを閉じたあと、`GroupGate` が行き先を決める
        reloadGroups();
        return;
      }
      leave();
    } catch (e) {
      const message = settlementErrorMessage(e, 'close');
      if (shouldReloadAfter(e)) {
        // サーバーが断った: 確認の内容が古い。読み直して、文言を添える。読み直せなければ、読み込みの失敗の表示にするが、
        // 断られた理由（「先に10月分の精算を済ませてください」など、次にやることが分かる情報）は、捨てずに並べる
        try {
          const data = await settlementService.loadClose(groupId, month);
          setLoad({ status: 'ready', data });
          setError(message);
        } catch (reloadError) {
          setLoad({ status: 'error', message: withReloadFailure(message, loadHomeErrorMessage(reloadError)) });
        }
      } else {
        setError(message);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  /** 「締める」を押したとき。締めるとグループが消える月は、確認ダイアログを挟む（取り消せない）。 */
  function requestClose() {
    if (running.current || model === null || model.state !== 'ready') return;
    const confirm = model.deleteConfirm;
    if (confirm === null) {
      void close();
      return;
    }
    Alert.alert(confirm.title, confirm.message, [
      { text: 'やめる', style: 'cancel' },
      {
        text: confirm.confirmLabel,
        style: 'destructive',
        // 外れたあと（セッション切れ・招待URLによる切り替え）に、開いたままの確認ダイアログから、書き込みを始めない
        onPress: () => {
          if (mounted.current) void close();
        },
      },
    ]);
  }

  // 読み込みの前後でも、見出しは同じ（`closeView.ts` の見出しと同じ形）
  const title = model?.title ?? `${formatMonthShort(month)}を締める`;

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

      {groupDeleted ? (
        <View style={styles.centered}>
          <Text style={[styles.message, { color: colors.textPrimary }]} accessibilityRole="alert">
            {GROUP_DELETED_MESSAGE}
          </Text>
          <PrimaryButton label="閉じる" onPress={leave} />
        </View>
      ) : load.status === 'loading' ? (
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
      ) : model !== null ? (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            {model.statusText !== null ? (
              <Text
                style={[styles.statusText, { color: colors.textPrimary }]}
                accessibilityRole={model.state === 'blocked' ? undefined : 'alert'}
              >
                {model.statusText}
              </Text>
            ) : null}

            {model.deleteWarning !== null ? (
              <Text
                style={[styles.emphasis, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.error }]}
                accessibilityRole="alert"
              >
                {model.deleteWarning}
              </Text>
            ) : null}

            {model.state !== 'closed' && !model.deletesGroup ? (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>確定する送金</Text>
                {model.lines.length > 0 ? (
                  <View style={styles.lines}>
                    {model.lines.map((line) => (
                      <TransferRow key={line.key} line={line} />
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.note, { color: colors.textPrimary }]}>{model.emptyText}</Text>
                )}
                {model.carryNote !== null ? (
                  <Text style={[styles.note, { color: colors.textSecondary }]}>{model.carryNote}</Text>
                ) : null}
              </View>
            ) : null}

            {model.midMonthNote !== null ? (
              <Text
                style={[styles.emphasis, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                {model.midMonthNote}
              </Text>
            ) : null}
            {model.leaveNotes.map((note) => (
              <Text key={note} style={[styles.note, { color: colors.textPrimary }]}>
                {note}
              </Text>
            ))}
            {model.state !== 'closed' && model.notice !== null ? (
              <Text style={[styles.note, { color: colors.textSecondary }]}>{model.notice}</Text>
            ) : null}
          </ScrollView>

          <View style={[styles.bottom, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            {/* 他のメンバーが先に締めていたとき（`closed`）は、上の案内（`ALREADY_CLOSED_TEXT`）が同じことを言うので、断りの文言は出さない */}
            {error !== null && model.state !== 'closed' ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            {model.state === 'closed' ? (
              <PrimaryButton label="閉じる" onPress={() => router.back()} />
            ) : (
              <>
                <PrimaryButton label={model.closeLabel} busy={busy} disabled={model.state !== 'ready'} onPress={requestClose} />
                <PrimaryButton label="キャンセル" variant="secondary" disabled={busy} onPress={() => router.back()} />
              </>
            )}
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 18, fontWeight: '700' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 18 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  lines: { gap: 14 },
  statusText: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 14, lineHeight: 20 },
  emphasis: { fontSize: 15, fontWeight: '700', lineHeight: 22, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, overflow: 'hidden' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  bottom: { gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
