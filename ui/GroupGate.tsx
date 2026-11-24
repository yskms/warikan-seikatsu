// ログイン後の最初の関門（docs/screens.md 1章）。所属グループを読んで、行き先を決める:
// グループが無い → グループ作成、ある → メイン（下のナビ。`app/(main)/_layout.tsx`）。
//
// 開くグループは、`ui/activeGroup.ts` のメモリ（この起動中に切り替えた・参加したもの）、端末に覚えた最後に開いたグループ
// （`platform/lastGroup.ts`）、作成の古い順の先頭、の順に決める（`src/services/groupChoice.ts`）。複数のグループに入っている人の
// 切り替えは、ホームの上部のグループ名から（`CurrentGroup` の `groups` と `select`。docs/screens.md 1章）。
//
// **招待**: 招待URLから来た人の参加確認（`app/join.tsx`。docs/screens.md 2章）は、ここでは扱わない。ルート（`app/_layout.tsx` の
// `RootNavigator`）が、招待を持っているあいだ、`(main)`（この画面）ごと外して、参加確認だけを出す。**招待の分岐を、ここ（や、
// `create-group` の画面）の `Redirect` に戻さない**（`Redirect` は、その画面にフォーカスがあるときしか動かず、ほかの画面・シートの上に
// 招待が届いても、参加確認へ移らない）。このゲートが描かれるのは、招待を持っていないときだけ。
//
// 参加した直後は、参加したグループを開く（参加確認の画面が `openGroup` で置く）。
import { Redirect } from 'expo-router';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupService } from '../platform/groupService.ts';
import { loadLastGroup } from '../platform/lastGroup.ts';
import type { GroupListItem } from '../src/domain/group.ts';
import { pickGroup } from '../src/services/groupChoice.ts';
import { loadGroupsErrorMessage } from '../src/services/groupMessage.ts';
import { openGroup, useActiveGroupId } from './activeGroup.ts';
import type { CurrentGroup } from './CurrentGroup.tsx';
import { useGroupsRevision } from './groupList.ts';
import { PrimaryButton } from './PrimaryButton.tsx';
import { useColors } from './useColors.ts';
import { useSignOut } from './useSignOut.ts';

/** 一覧の読み直しが失敗したときの、やり直しの間隔（ミリ秒）。これを使い切ったら、前の一覧のままにする */
const REFRESH_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; groups: GroupListItem[]; lastGroupId: string | null };

export function GroupGate({ children }: { children: (group: CurrentGroup) => ReactNode }) {
  const colors = useColors();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの合図（「もう一度」を押すたびに増やす）
  const [attempt, setAttempt] = useState(0);
  const { confirmSignOut, busy: signingOut, error: signOutError } = useSignOut();
  const activeGroupId = useActiveGroupId();
  // 脱退・グループの削除のあとの読み直しの合図（`ui/groupList.ts` の `reloadGroups`）
  const revision = useGroupsRevision();

  // 一覧を読み込み済みか（読み直しの失敗を、やり直すかの判断に使う）
  const hasList = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 読み込み済みの一覧は、読み直しのあいだも残す（画面を、読み込み中の表示に差し替えない。いま開いているグループの画面が、
    // 脱退の案内を出している最中かもしれない）。最初の読み込みと、失敗からの「もう一度」だけ、読み込み中にする
    setLoad((current) => (current.status === 'loaded' ? current : { status: 'loading' }));
    const run = (retry: number) => {
      // 端末に覚えた最後に開いたグループは、一覧と一緒に読む（読めなければ `null`。投げない）
      Promise.all([groupService.listGroups(), loadLastGroup()]).then(
        ([groups, lastGroupId]) => {
          if (cancelled) return;
          hasList.current = true;
          setLoad({ status: 'loaded', groups, lastGroupId });
        },
        (error: unknown) => {
          if (cancelled) return;
          // 読み直しの失敗は、前の一覧のままにする（最初の読み込みの失敗だけ、エラーの表示にする。「もう一度」がある）
          setLoad((current) =>
            current.status === 'loaded' ? current : { status: 'error', message: loadGroupsErrorMessage(error) },
          );
          // 前の一覧がある（読み直しの失敗）ときは、少し置いて、数回やり直す。グループが消えた・脱退したあとの読み直しが、
          // 通信の失敗で止まると、読めなくなったグループの画面に留まり、ログアウトしか抜け道が無くなるため
          const delay = hasList.current ? REFRESH_RETRY_DELAYS_MS[retry] : undefined;
          if (delay !== undefined) timer = setTimeout(() => run(retry + 1), delay);
        },
      );
    };
    run(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [attempt, revision]);

  if (load.status === 'loaded' && load.groups.length === 0) return <Redirect href="/create-group" />;
  // グループがある。ホームが、自分でデータを読む（ホームへ戻るたびに取り直す）ので、ここで読んだ一覧は、グループの特定と、切り替えの
  // 候補にだけ使う。切り替えた・参加したグループ（メモリ）、最後に開いたグループ（端末）の順に、一覧にあるものを開く。
  const current =
    load.status === 'loaded' ? pickGroup(load.groups, [activeGroupId, load.lastGroupId]) : undefined;
  // グループが変わったら、画面ごと作り直す（`key`。ホームは、グループごとの読み込みの状態を持つ）
  if (load.status === 'loaded' && current) {
    return (
      <Fragment key={current.id}>
        {children({
          id: current.id,
          name: current.name,
          groups: load.groups.map((group) => ({ id: group.id, name: group.name })),
          select: openGroup,
        })}
      </Fragment>
    );
  }

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
