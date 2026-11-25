// メイン（docs/screens.md 1章）。下のナビは「ホーム・＋・設定」の3つ。＋は真ん中に置き、押すと支出の登録のシート
// （`app/expense.tsx`）を開く（＋は画面ではなく、押したときの操作。`add.tsx` は、ナビに場所を作るためだけの空の画面）。
// 所属グループは `GroupGate` が読み、3つの画面へ `CurrentGroupProvider` で渡す。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { CurrentGroupProvider, useCurrentGroup } from '../../ui/CurrentGroup.tsx';
import { GroupGate } from '../../ui/GroupGate.tsx';
import { useColors } from '../../ui/useColors.ts';

export default function MainLayout() {
  return (
    <GroupGate>
      {(group) => (
        <CurrentGroupProvider value={group}>
          <MainTabs />
        </CurrentGroupProvider>
      )}
    </GroupGate>
  );
}

function MainTabs() {
  const colors = useColors();
  const router = useRouter();
  const group = useCurrentGroup();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 選んでいるタブは、アイコンの塗りと文字の太さで示す（ピンクは、白の上で文字の色に足りない。`src/theme/colors.ts`）
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ color, focused, size }) => (
            <MaterialCommunityIcons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '支出を登録',
          tabBarAccessibilityLabel: '支出を登録',
          tabBarLabel: () => null,
          tabBarButton: ({ onPress, accessibilityLabel }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel ?? '支出を登録'}
              onPress={onPress}
              style={styles.addSlot}
            >
              <Pressable
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                onPress={onPress}
                style={({ pressed }) => [styles.addButton, { backgroundColor: colors.accent }, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="plus" size={30} color={colors.onAccent} />
              </Pressable>
            </Pressable>
          ),
        }}
        listeners={{
          // ＋は、タブの切り替えではなく、シートを開く
          tabPress: (event) => {
            event.preventDefault();
            router.push({ pathname: '/expense', params: { groupId: group.id } });
          },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: ({ color, focused, size }) => (
            <MaterialCommunityIcons name={focused ? 'cog' : 'cog-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
