// ログイン後の最初の画面（docs/screens.md 1章）。所属グループを読んで、行き先を決める:
// グループが無い → グループ作成、ある → メイン（ホーム）。
//
// **ホームは仮のまま**: グループ名と、ログアウトだけを出す。ホーム（3章）と、下のナビ・設定（6章）を作るときに置き換える
// （ログアウトは設定へ移す。`ui/useSignOut.ts`）。複数のグループに入っている人の切り替えと、最後に開いたグループを
// 覚えておくことも、そのとき作る（いまは、作成の古い順の先頭を出す）。
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupService } from '../platform/groupService.ts';
import type { GroupListItem } from '../src/domain/group.ts';
import { loadGroupsErrorMessage } from '../src/services/groupMessage.ts';
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

        {load.status === 'loaded' && load.groups[0] ? (
          <>
            <Text style={[styles.groupName, { color: colors.textPrimary }]} accessibilityRole="header">
              {load.groups[0].name}
            </Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>ホームは、これから作ります。</Text>
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
  groupName: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  footer: { gap: 12, paddingBottom: 16 },
});
