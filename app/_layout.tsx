import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { startInviteLinks } from '../platform/inviteLink.ts';
import { AuthStateProvider, useAuth } from '../ui/AuthStateProvider.tsx';
import { useColors } from '../ui/useColors.ts';
import { useInviteLinksReady } from '../ui/usePendingInvite.ts';

// 端末のログイン情報を調べ終えるまで、スプラッシュを出したままにする（調べ終えたら `RootNavigator` が隠す）。
// 読めないときは、読み直しで最長約3.5秒かかる（`src/services/sessionCheck.ts`）。そのあいだ、無地の画面を出すと、固まって
// 見える。ダークでは、スプラッシュ（白）から暗い無地の画面へ、色も一瞬変わる。
void SplashScreen.preventAutoHideAsync().catch(() => {});

// 招待URLの受け取りを、できるだけ早く始める（起動したときのURLを、ログインの判定が終わるまでに読み終える。
// `platform/inviteLink.ts`）。
startInviteLinks();

export default function RootLayout() {
  return (
    <AuthStateProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthStateProvider>
  );
}

// ログインの状態で、見せる画面を切り替える。ログイン済みなら、ログイン画面へは行けない（逆も同じ）。
// 端末のログイン情報を調べているあいだは、何も描かず、スプラッシュを出したままにする（「未ログイン」と決めつけて、
// ログイン画面を一瞬出さない）。起動したときのURL（招待URLかもしれない）を読み終えるまでも、同じ（読む前に、ログイン後の分岐が
// 動くと、招待された人が、グループの作成画面へ回される。`ui/GroupGate.tsx`）。
function RootNavigator() {
  const { state } = useAuth();
  const colors = useColors();
  const linksReady = useInviteLinksReady();
  const checking = state.status === 'checking' || !linksReady;
  useEffect(() => {
    if (!checking) void SplashScreen.hideAsync().catch(() => {});
  }, [checking]);
  if (checking) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={state.status === 'signed-in'}>
        <Stack.Screen name="(main)" />
        <Stack.Screen name="create-group" />
        {/* 招待URLを開いたあとの参加確認。iOSのスワイプでは戻らない（抜ける道は「キャンセル」。招待を手放して、最初の画面へ戻る） */}
        <Stack.Screen name="join" options={{ gestureEnabled: false }} />
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
      <Stack.Protected guard={state.status === 'signed-out'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
