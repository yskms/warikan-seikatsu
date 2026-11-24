import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { startInviteLinks } from '../platform/inviteLink.ts';
import { AuthStateProvider, useAuth } from '../ui/AuthStateProvider.tsx';
import { useColors } from '../ui/useColors.ts';
import { useInviteLinksReady, usePendingInvite } from '../ui/usePendingInvite.ts';

// 端末のログイン情報を調べ終えるまで、スプラッシュを出したままにする（調べ終えたら `RootNavigator` が隠す）。
// 読めないときは、読み直しで最長約3.5秒かかる（`src/services/sessionCheck.ts`）。そのあいだ、無地の画面を出すと、固まって
// 見える。ダークでは、スプラッシュ（白）から暗い無地の画面へ、色も一瞬変わる。
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // 招待URLの受け取りを始める。ルートが描かれるたびに、起動したときのURLを読み直す（Activityが作り直されたとき、`url` イベントが
  // 届かないため。`platform/inviteLink.ts`）。
  useEffect(() => {
    startInviteLinks();
  }, []);
  return (
    <AuthStateProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthStateProvider>
  );
}

// ログインの状態で、見せる画面を切り替える。ログイン済みなら、ログイン画面へは行けない（逆も同じ）。
// 端末のログイン情報を調べているあいだは、何も描かず、スプラッシュを出したままにする（「未ログイン」と決めつけて、
// ログイン画面を一瞬出さない）。起動したときのURL（招待URLかもしれない）を読み終えるまでも、同じ（読む前に、ログイン後の画面が
// 描かれ、グループの一覧の読み込みや、グループの作成への分岐が動くと、招待された人が、作る必要のないグループの作成画面へ回される。
// 招待が、遅れて届いても、下の `Stack.Protected` が、どの画面にいても参加確認へ移すので、最悪でも、一瞬、別の画面が出るだけ）。
function RootNavigator() {
  const { state } = useAuth();
  const colors = useColors();
  const linksReady = useInviteLinksReady();
  // 参加の確認を待っている招待（`platform/inviteLink.ts`）
  const invited = usePendingInvite() !== null;
  const checking = state.status === 'checking' || !linksReady;
  useEffect(() => {
    if (!checking) void SplashScreen.hideAsync().catch(() => {});
  }, [checking]);
  if (checking) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      {/* 招待を持っているあいだ（`pendingInvite`）は、ログイン済みでも、参加確認（`join`）だけを出す。**この切り替えを、`GroupGate` や
          画面ごとの `Redirect` に移さない**: `Redirect` は、その画面にフォーカスがあるときしか動かない（グループ作成の画面や、設定の
          先の画面・シートが開いていると、参加確認へ移らない）。ここで外せば、どの画面にいても、参加確認が出る（開いていた画面・シートは
          閉じられ、入力中のものは失われる。招待URLを開くのは、アプリの外から来る操作なので、割り込みを許す）。招待を手放すと
          （参加・キャンセルなど）、最初の画面（メイン、またはグループの作成）からやり直す。 */}
      <Stack.Protected guard={state.status === 'signed-in' && !invited}>
        <Stack.Screen name="(main)" />
        <Stack.Screen name="create-group" />
        <Stack.Screen name="categories" />
        <Stack.Screen name="members" />
        {/* シート（モーダル）は、`dangerouslySingular` で、同じ画面を2枚重ねない。開くボタンを素早く2回押すと、`router.push` が
            2回通り、シートが2枚重なって、閉じても下のシートが残る（エミュレータで確かめた）。すでに開いていれば、その1枚を使う */}
        {/* 支出の登録・編集のシート。下から出る。入力中の破棄の確認を出すため、スワイプで閉じるのは止める（✕・戻る操作は確認する） */}
        <Stack.Screen name="expense" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
        {/* 月を締める前の確認のシート。締めている最中に閉じないよう、スワイプで閉じるのは止める（✕・戻る操作は、最中だけ止める） */}
        <Stack.Screen name="close" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
        {/* カテゴリの追加・編集のシート。入力中の破棄の確認を出すため、スワイプで閉じるのは止める（✕・戻る操作は、`beforeRemove` で確認する） */}
        <Stack.Screen name="category-edit" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed-in' && invited}>
        {/* 招待URLを開いたあとの参加確認。iOSのスワイプでは戻らない（抜ける道は「キャンセル」。招待を手放す） */}
        <Stack.Screen name="join" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed-out'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
