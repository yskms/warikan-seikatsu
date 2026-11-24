// 招待URLを開いたあとの参加確認（docs/screens.md 2章の「参加確認」）。**開いただけでは参加しない**: 招待の内容（グループ名・招待した人）を
// 見せ、自分の表示名を入力して「参加する」を押したときだけ参加する。
//
// - 内容の確認（`GET /invites/:token`）は、画面を開いたときに1回。すでにそのグループに参加中なら、何も出さず、そのグループを開く。
//   使えない招待（期限切れ・使用済み・取り消し済みなど。区別されない）は、その案内と「閉じる」だけを出す。満員（`groupFull`）なら、
//   表示名を入力させず、案内を出して「参加する」を押せなくする（人数は、アプリで数えない）。
// - 参加（`POST /invites/:token/join`）は、**送り直してよい**: 結果が分からない失敗のあとにもう一度押せば、参加が済んでいたときは、
//   サーバーが 409 `already_member` で教える。それを成功として扱い、そのグループを開く（`src/services/joinMessage.ts`）。
//   失敗のあとに、自動では送り直さない。
// - 終わり方は、どれも招待を手放すこと（`pendingInvite.clear`）。手放すと、`app/join.tsx` が最初の画面へ戻し、グループの一覧を
//   読み直す。参加したグループは、`openGroup` で開く（次の起動でも、そのグループが開く）。
// - レイアウトとキーボードの避け方は、グループ作成（`app/create-group.tsx`）と同じ: ボタンは下に固定し、失敗の文言はその上に出す。
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { inviteService } from '../../platform/inviteService.ts';
import { pendingInvite } from '../../platform/inviteLink.ts';
import { validateDisplayName } from '../../src/services/groupForm.ts';
import {
  classifyJoinFailure,
  classifyPreviewFailure,
  GROUP_FULL_MESSAGE,
  INVITE_UNAVAILABLE_MESSAGE,
} from '../../src/services/joinMessage.ts';
import { openGroup } from '../activeGroup.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { TextField } from '../TextField.tsx';
import { useColors } from '../useColors.ts';

type Step =
  | { kind: 'loading' }
  /** 内容を確認できなかった（やり直せる） */
  | { kind: 'error'; message: string }
  /** 使えない招待 */
  | { kind: 'unavailable' }
  | { kind: 'ready'; groupName: string; invitedByDisplayName: string; groupFull: boolean };

export function JoinScreen({ token }: { token: string }) {
  const colors = useColors();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  // 内容の読み直しの合図（「もう一度」を押すたびに増やす）
  const [attempt, setAttempt] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  // 招待を手放して終える。参加した（または、すでに参加していた）グループがあれば、それを開く。
  function finish(groupId: string | null) {
    if (groupId !== null) openGroup(groupId);
    pendingInvite.clear(token);
  }

  useEffect(() => {
    let cancelled = false;
    setStep({ kind: 'loading' });
    inviteService.preview(token).then(
      (preview) => {
        if (cancelled) return;
        // すでに参加中なら、確認は出さず、そのグループを開くだけにする
        if (preview.alreadyMember) {
          finish(preview.groupId);
          return;
        }
        setStep({
          kind: 'ready',
          groupName: preview.groupName,
          invitedByDisplayName: preview.invitedByDisplayName,
          groupFull: preview.groupFull,
        });
      },
      (e: unknown) => {
        if (cancelled) return;
        const failure = classifyPreviewFailure(e);
        setStep(failure.kind === 'unavailable' ? { kind: 'unavailable' } : { kind: 'error', message: failure.message });
      },
    );
    return () => {
      cancelled = true;
    };
    // `finish` は、`token` だけに依る（描くたびに作り直されるが、中身は同じ）ので、依存に入れない
  }, [token, attempt]);

  async function join() {
    if (submitting.current || step.kind !== 'ready' || step.groupFull) return;
    const result = validateDisplayName(displayName);
    if (!result.ok) {
      setFieldError(result.error);
      setError(null);
      return;
    }
    setFieldError(undefined);
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const joined = await inviteService.join(token, result.value);
      finish(joined.groupId);
    } catch (e) {
      const failure = classifyJoinFailure(e);
      switch (failure.kind) {
        case 'unavailable':
          setStep({ kind: 'unavailable' });
          break;
        case 'full':
          // 確認のあとに埋まった。満員の案内に切り替え（入力欄は隠れる）、「参加する」を押せなくする
          setStep((current) => (current.kind === 'ready' ? { ...current, groupFull: true } : current));
          break;
        case 'already-member':
          finish(failure.groupId);
          break;
        case 'failed':
          setError(failure.message);
          break;
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const ready = step.kind === 'ready' ? step : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* edge-to-edge では、Androidも、キーボードでウィンドウが小さくならないので、`padding` で避ける（グループ作成と同じ） */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
            {step.kind === 'unavailable' ? 'この招待は使えません' : 'グループへの招待'}
          </Text>

          {step.kind === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.textSecondary} accessibilityLabel="招待を確認中" />
            </View>
          ) : null}

          {step.kind === 'error' ? (
            <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
              {step.message}
            </Text>
          ) : null}

          {step.kind === 'unavailable' ? (
            <Text style={[styles.message, { color: colors.textSecondary }]} accessibilityRole="alert">
              {INVITE_UNAVAILABLE_MESSAGE}
            </Text>
          ) : null}

          {ready ? (
            <>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <InfoRow label="グループ" value={ready.groupName} />
                <InfoRow label="招待した人" value={ready.invitedByDisplayName} />
              </View>

              {ready.groupFull ? (
                <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
                  {GROUP_FULL_MESSAGE}
                </Text>
              ) : (
                <TextField
                  label="自分の表示名"
                  value={displayName}
                  onChangeText={(text) => {
                    setDisplayName(text);
                    setFieldError(undefined);
                  }}
                  placeholder="このグループの中での名前"
                  error={fieldError}
                  editable={!busy}
                  returnKeyType="done"
                  onSubmitEditing={() => void join()}
                />
              )}
            </>
          ) : null}
        </ScrollView>

        {/* ボタンは、画面の下に固定し、失敗の文言はその上に出す（グループ作成・ログイン画面と同じ理由） */}
        <View style={styles.footer}>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {ready ? (
            <>
              <PrimaryButton label="参加する" busy={busy} disabled={ready.groupFull} onPress={() => void join()} />
              <PrimaryButton label="キャンセル" variant="secondary" disabled={busy} onPress={() => pendingInvite.clear(token)} />
            </>
          ) : null}
          {step.kind === 'error' ? (
            <>
              <PrimaryButton label="もう一度" onPress={() => setAttempt((n) => n + 1)} />
              <PrimaryButton label="キャンセル" variant="secondary" onPress={() => pendingInvite.clear(token)} />
            </>
          ) : null}
          {step.kind === 'unavailable' ? <PrimaryButton label="閉じる" onPress={() => pendingInvite.clear(token)} /> : null}
          {step.kind === 'loading' ? (
            <PrimaryButton label="キャンセル" variant="secondary" onPress={() => pendingInvite.clear(token)} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow} accessible accessibilityLabel={`${label}、${value}`}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, gap: 20 },
  footer: { paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  center: { paddingVertical: 24, alignItems: 'center' },
  message: { fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  infoRow: { paddingVertical: 8, gap: 2 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 18, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
