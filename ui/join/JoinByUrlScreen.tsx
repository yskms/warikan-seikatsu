// 招待URLを貼り付けて参加確認へ進む専用の画面（docs/screens.md 2章の「グループ作成」の、「招待を受け取った方はこちら」の先）。
//
// 招待URLは、ふつう、タップするとアプリが直接開く（`platform/inviteLink.ts`）。ただし、アプリを入れてから、そのまま開いた人は、
// URLをもう一度開くことを知らないと、グループ作成の画面しか出ない。その人が、作る必要のないグループを作らずに済むための入口。
// **グループ作成の画面の中には置かない**（同じ画面に、ピンクの「作成」が常に出ていて、押し間違えやすく、どちらをすればよいか
// 分かりにくかった）。この画面には「作成」を置かず、操作は、貼り付けて「参加の確認へ」だけにする。
//
// **やるのは、貼り付けたものからトークンを取り出して、`pendingInvite.set` に渡すことだけ**（`src/services/joinMessage.ts` の
// `readInviteInput`）。招待が使えるか・満員か・参加済みか・参加そのものは、参加確認（`ui/join/JoinScreen.tsx`）が、招待URLを開いたときと
// 同じ経路で扱う（参加の規則を、ここに書き写さない）。参加確認へ切り替えるのも、ルート（`app/_layout.tsx` の `Stack.Protected`）で、
// ここでは画面を動かさない（招待を持つと、この画面は外れる）。戻る（見出しの矢印）で、グループ作成の画面へ戻る。
// レイアウトとキーボードの避け方は、グループ作成（`app/create-group.tsx`）と同じ: ボタンは下に固定し、失敗の文言は欄の下に出す。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pendingInvite } from '../../platform/inviteLink.ts';
import { readInviteInput } from '../../src/services/joinMessage.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { TextField } from '../TextField.tsx';
import { useColors } from '../useColors.ts';

export function JoinByUrlScreen() {
  const colors = useColors();
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function submit() {
    const result = readInviteInput(text);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(undefined);
    pendingInvite.set(result.token);
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          招待URLで参加
        </Text>
      </View>
      {/* edge-to-edge では、Androidも、キーボードでウィンドウが小さくならないので、iOSと同じく padding で避ける（グループ作成と同じ） */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            招待してくれた人から届いたURLを貼り付けてください。メッセージごと貼り付けても読み取れます。グループを作る必要はありません。
          </Text>
          <TextField
            label="招待URL"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(undefined);
            }}
            placeholder="https://warikan-seikatsu.app/invite/…"
            error={error}
            autoFocus
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="参加の確認へ" onPress={submit} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 8 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 20 },
  lead: { fontSize: 15, lineHeight: 22 },
  footer: { paddingHorizontal: 24, paddingBottom: 16 },
});
