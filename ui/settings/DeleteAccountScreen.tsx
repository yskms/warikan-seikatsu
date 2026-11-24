// アカウントを削除する画面（設定から。docs/screens.md 6章の「アカウントを削除」）。`app/delete-account.tsx` の中身。
//
// 流れ: 説明を読む → 「アカウントを削除」→ 確認ダイアログ → 各社（Apple・Google）の画面で本人確認（再認証）→ 削除。
// 再認証と削除の手順は、`accountService.deleteAccount`（`platform/accountService.ts` の包み。端末のセッションが無くなったことを
// ログイン状態へ伝えるのは、その包みだけ）。この画面は、手順にも、Workerのデータの扱いにも触れない。
//
// - **削除に成功すると、この画面は外れる**: 端末のセッションが無くなり、ルート（`app/_layout.tsx`）がログイン画面へ切り替える
//   （`Stack.Protected`。`beforeRemove` を通らない）。結果の文言は、この画面ではなく、ログイン画面の上に出す（`ui/loginNotice.ts`）。
//   サーバーが認めなかった（401）ときも同じ（端末のセッションを捨ててログイン画面へ移る）。
// - 端末のセッションを捨てられなかったとき（`sessionCleared: false`）だけ、この画面が残る。削除は済んでいるので、結果を出し、
//   「ログアウト」を案内する（端末の値を捨てられる）。もう削除はできない。
// - 実行中（再認証の画面を待つあいだと通信）は、戻る操作を止める（結果を受けるのは、この画面）。止めているのは `beforeRemove`
//   で、セッション切れの除去は通らない。招待URLによる参加確認への切り替えは、実行中だけ遅らせる（`useHoldInviteSwap`）。
// - **確認ダイアログから削除を始めるので、画面が外れていれば何もしない**（`useMounted`）。外れたあとに、取り消せない削除を、
//   見えない画面から始めない。
// - 削除のあと、最後に開いたグループの記憶（`platform/lastGroup.ts`・`ui/activeGroup.ts`）は消さない（ログアウトと同じ。グループの
//   IDだけで、サーバーが所属を確かめる。一覧に無いIDは、開くグループを選ぶときに飛ばす）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { accountService } from '../../platform/accountService.ts';
import { deletedNotice, deleteAccountFailure } from '../../src/services/deleteAccountMessage.ts';
import { useHoldInviteSwap } from '../inviteHold.ts';
import { setLoginNotice } from '../loginNotice.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { useMounted } from '../useMounted.ts';
import { useSignOut } from '../useSignOut.ts';

// 削除する前に伝えること（docs/plan.md 8章の「アカウント削除」）。サーバーの扱いと合わせる
const POINTS = [
  '参加しているすべてのグループから、すぐに脱退します（月の終わりを待ちません）。',
  '表示名は「削除されたユーザー」になります。支出や精算の記録は、残るメンバーのために、グループに残ります。',
  '自分だけが残っているグループは、グループごと削除されます。',
  '精算が済んでいない送金があるときは、削除すると、その送金は次の月への繰越を選べなくなります。金額と送金の向きは残るので、残るメンバーが確認して、精算済みにします。',
  '元に戻せません。',
] as const;

export function DeleteAccountScreen() {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const mounted = useMounted();
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は済んだが、端末のログイン情報を消せなかった（この画面が残るのは、このときだけ）
  const [done, setDone] = useState<string[] | null>(null);
  const running = useRef(false);
  useHoldInviteSwap(busy);

  // 実行中は閉じない（上のコメント）
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (running.current) event.preventDefault();
    });
  }, [navigation]);

  // iOSの端のスワイプで戻る操作は、ネイティブ側で先に実行され、`beforeRemove` で止めても戻ってしまうことがある（Singfolioの
  // `usePreventRemove` と同じ理由）。実行中だけ、スワイプを無効にする（✕ではなく戻る矢印・Androidの戻る操作は、上で止めている）
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !busy });
  }, [navigation, busy]);

  // 結果を、読み上げにも伝える（Androidは、`accessibilityLiveRegion` が伝える）
  useEffect(() => {
    if (error !== null && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  function goBack() {
    if (running.current) return;
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await accountService.deleteAccount();
      const lines = deletedNotice(result);
      if (result.sessionCleared) {
        // この画面は、ログイン画面への切り替えで外れる。結果は、ログイン画面の上に出す
        setLoginNotice(lines);
      } else if (mounted.current) {
        setDone(lines);
      }
    } catch (e) {
      const failure = deleteAccountFailure(e);
      if (failure.signedOut) {
        // 端末のセッションが捨てられ、この画面は外れる。文言は、ログイン画面の上に出す（外れる前後のどちらでも、同じ入れ物）
        if (failure.message !== null) setLoginNotice([failure.message]);
      } else if (mounted.current) {
        setError(failure.message);
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function confirmDelete() {
    if (running.current) return;
    Alert.alert(
      'アカウントを削除しますか？',
      '元に戻せません。次に、ログインに使ったAppleまたはGoogleの画面で、本人確認をします。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          // 外れた画面から、取り消せない削除を始めない
          onPress: () => {
            if (mounted.current) void run();
          },
        },
      ],
    );
  }

  const disabled = busy || signOut.busy;
  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          accessibilityState={{ disabled: busy }}
          hitSlop={8}
          onPress={goBack}
          style={[styles.back, busy && styles.dimmed]}
        >
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          アカウントを削除
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {done !== null ? (
          <View style={styles.block}>
            {done.map((line) => (
              <Text key={line} style={[styles.body, { color: colors.textPrimary }]} accessibilityLiveRegion="polite">
                {line}
              </Text>
            ))}
            {signOut.error ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {signOut.error}
              </Text>
            ) : null}
            <PrimaryButton label="ログアウト" busy={signOut.busy} onPress={() => void signOut.signOut()} />
          </View>
        ) : (
          <>
            <View style={styles.block}>
              <Text style={[styles.lead, { color: colors.textPrimary }]}>削除すると、次のようになります。</Text>
              {POINTS.map((point) => (
                <View key={point} style={styles.point}>
                  <Text style={[styles.bullet, { color: colors.textSecondary }]}>・</Text>
                  <Text style={[styles.body, styles.pointText, { color: colors.textPrimary }]}>{point}</Text>
                </View>
              ))}
            </View>

            {error ? (
              <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            <View style={styles.block}>
              <PrimaryButton label="アカウントを削除" variant="destructive" busy={busy} disabled={disabled} onPress={confirmDelete} />
              {busy ? (
                <Text style={[styles.note, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
                  本人確認と削除を行っています。最大30秒ほどかかります。
                </Text>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 24 },
  block: { gap: 12 },
  lead: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  point: { flexDirection: 'row', gap: 4 },
  bullet: { fontSize: 15, lineHeight: 23 },
  pointText: { flex: 1 },
  body: { fontSize: 15, lineHeight: 23 },
  error: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  dimmed: { opacity: 0.5 },
});
