import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { AuthStateProvider, useAuth } from '../ui/AuthStateProvider.tsx';
import { useColors } from '../ui/useColors.ts';

// 端末のログイン情報を調べ終えるまで、スプラッシュを出したままにする（調べ終えたら `RootNavigator` が隠す）。
// 読めないときは、読み直しで最長約3.5秒かかる（`src/services/sessionCheck.ts`）。そのあいだ、無地の画面を出すと、固まって
// 見える。ダークでは、スプラッシュ（白）から暗い無地の画面へ、色も一瞬変わる。
void SplashScreen.preventAutoHideAsync().catch(() => {});

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
// ログイン画面を一瞬出さない）。
function RootNavigator() {
  const { state } = useAuth();
  const colors = useColors();
  const checking = state.status === 'checking';
  useEffect(() => {
    if (!checking) void SplashScreen.hideAsync().catch(() => {});
  }, [checking]);
  if (checking) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={state.status === 'signed-in'}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'signed-out'}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
