// ログイン後の最初の画面（docs/screens.md 1章）。所属グループを読んで、行き先を決める:
// グループが無い → グループ作成、ある → メイン（ホーム。`ui/home/HomeScreen.tsx`）。
//
// 複数のグループに入っている人の切り替えと、最後に開いたグループを覚えておくことは、まだ作っていない（いまは、作成の古い順の
// 先頭を出す）。下のナビ・設定（6章）も、まだ無い（ログアウトは、ホームの最後に仮に置いてある。設定を作るとき、そちらへ移す。
// `ui/useSignOut.ts`）。
//
// **注意（招待）**: いまの分岐は、「グループが無ければグループ作成」を無条件に行う。招待URLから来た人は、ログイン後に
// 参加確認へ進む（docs/screens.md 2章）ので、招待を保持する仕組みを足すときは、**この分岐で、保持した招待を先に見て**、
// 参加確認へ回すこと（そうしないと、招待された人が、作る必要のないグループの作成画面へ回される）。作成画面には、
// 作らずに出る道として、ログアウトだけを置いてある。
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupService } from '../platform/groupService.ts';
import type { GroupListItem } from '../src/domain/group.ts';
import { loadGroupsErrorMessage } from '../src/services/groupMessage.ts';
import { HomeScreen } from '../ui/home/HomeScreen.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { useColors } from '../ui/useColors.ts';
import { useSignOut } from '../ui/useSignOut.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; groups: GroupListItem[] };

export default function Index() {
  const colors = useColors();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの合図（「もう一度」を押すたびに増やす）
  const [attempt, setAttempt] = useState(0);
  const { confirmSignOut, busy: signingOut, error: signOutError } = useSignOut();

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    groupService.listGroups().then(
      (groups) => {
        if (!cancelled) setLoad({ status: 'loaded', groups });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: loadGroupsErrorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (load.status === 'loaded' && load.groups.length === 0) return <Redirect href="/create-group" />;
  // グループがある。ホームが、自分でデータを読む（ホームへ戻るたびに取り直す）ので、ここで読んだ一覧は、グループの特定にだけ使う。
  const first = load.status === 'loaded' ? load.groups[0] : undefined;
  // グループが変わったら、画面ごと作り直す（`key`。ホームは、グループごとの読み込みの状態を持つ）
  if (first) return <HomeScreen key={first.id} groupId={first.id} groupName={first.name} />;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        {load.status === 'loading' ? <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" /> : null}

        {load.status === 'error' ? (
          <>
            <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
              {load.message}
            </Text>
            <PrimaryButton label="もう一度" onPress={() => setAttempt((n) => n + 1)} />
          </>
        ) : null}

      </View>

      {/* 読み込みに失敗したままでも、ログアウトできるようにする（先へ進めなくなるのを避ける） */}
      <View style={styles.footer}>
        {signOutError ? (
          <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {signOutError}
          </Text>
        ) : null}
        <PrimaryButton label="ログアウト" variant="secondary" busy={signingOut} onPress={confirmSignOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  body: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16 },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  footer: { gap: 12, paddingBottom: 16 },
});
