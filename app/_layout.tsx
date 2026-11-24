import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { startInviteLinks } from '../platform/inviteLink.ts';
import { AuthStateProvider, useAuth } from '../ui/AuthStateProvider.tsx';
import { useColors } from '../ui/useColors.ts';
import { useInviteSwapHeld } from '../ui/inviteHold.ts';
import { useInviteLinksReady, usePendingInvite } from '../ui/usePendingInvite.ts';

// 端末のログイン情報を調べ終えるまで、スプラッシュを出したままにする（調べ終えたら `RootNavigator` が隠す）。
// 読めないときは、読み直しで最長約3.5秒かかる（`src/services/sessionCheck.ts`）。そのあいだ、無地の画面を出すと、固まって
// 見える。ダークでは、スプラッシュ（白）から暗い無地の画面へ、色も一瞬変わる。
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // 招待URLの受け取りを始める。**ルートがマウントされるたび**（依存は `[]`。描画のたびではない）に、起動したときのURLを読み直す
  // （Androidで、新しいActivityが作られ、ルートがマウントし直されたとき、`url` イベントが届かないため。`platform/inviteLink.ts`）。
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
  const pending = usePendingInvite() !== null;
  // 書き込みの最中の画面（支出・月締め・カテゴリ編集のシート、グループ作成）があるあいだは、切り替えを遅らせる（`ui/inviteHold.ts`）。
  // 終わったら切り替わる。**参加確認を出しているあいだは、遅らせない**（そこには、書き込みの最中の画面は無い）
  const held = useInviteSwapHeld();
  const showJoin = pending && !held;
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
          閉じられ、入力中のものは失われる。招待URLを開くのは、アプリの外から来る操作なので、割り込みを許す。ただし、書き込みの最中の
          画面があるあいだは、終わるまで遅らせる）。招待を手放すと（参加・キャンセルなど）、最初の画面（メイン、またはグループの作成）
          からやり直す。 */}
      <Stack.Protected guard={state.status === 'signed-in' && !showJoin}>
        <Stack.Screen name="(main)" />
        <Stack.Screen name="create-group" />
        {/* カテゴリと負担割合も、`dangerouslySingular` で、2枚重ねない（入口は、設定の行だけ）。下の `members` と同じ仕組みで、
            素早く2回押すと重なるはず（エミュレータでは、付ける前も付けたあとも未確認。docs/screens.md 5章） */}
        <Stack.Screen name="categories" dangerouslySingular />
        {/* メンバーと招待は、`dangerouslySingular` で、2枚重ねない。入口は、設定の行と、ホームの「相手を招待する」カード。素早く2回
            押すと、`router.push` が2回通り、画面が2枚重なる（エミュレータで確かめた）。この画面は、発行した招待のトークンを画面の
            メモリだけに持つので、重なっていると、上の画面で発行して戻ったとき、下の画面の一覧では「共有」で出し直せない */}
        <Stack.Screen name="members" dangerouslySingular />
        {/* シート（モーダル）は、`dangerouslySingular` で、同じ画面を2枚重ねない。開くボタンを素早く2回押すと、`router.push` が
            2回通り、シートが2枚重なって、閉じても下のシートが残る（エミュレータで確かめた）。すでに開いていれば、その1枚を使う */}
        {/* 支出の登録・編集のシート。下から出る。入力中の破棄の確認を出すため、スワイプで閉じるのは止める（✕・戻る操作は確認する） */}
        <Stack.Screen name="expense" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
        {/* 月を締める前の確認のシート。締めている最中に閉じないよう、スワイプで閉じるのは止める（✕・戻る操作は、最中だけ止める） */}
        <Stack.Screen name="close" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
        {/* カテゴリの追加・編集のシート。入力中の破棄の確認を出すため、スワイプで閉じるのは止める（✕・戻る操作は、`beforeRemove` で確認する） */}
        <Stack.Screen name="category-edit" dangerouslySingular options={{ presentation: 'modal', gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed-in' && showJoin}>
        {/* 招待URLを開いたあとの参加確認。iOSのスワイプでは戻らない（抜ける道は「キャンセル」。招待を手放す） */}
        <Stack.Screen name="join" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed-out'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
