import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { AuthProvider, useAuth } from '../ui/AuthProvider.tsx';
import { useColors } from '../ui/useColors.ts';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootNavigator />
    </AuthProvider>
  );
}

// ログインの状態で、見せる画面を切り替える。ログイン済みなら、ログイン画面へは行けない（逆も同じ）。
// 端末のログイン情報を調べているあいだは、何も出さない（「未ログイン」と決めつけて、ログイン画面を一瞬出さない）。
function RootNavigator() {
  const { state } = useAuth();
  const colors = useColors();
  if (state.status === 'checking') return <View style={{ flex: 1, backgroundColor: colors.background }} />;
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
