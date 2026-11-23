// グループ作成（docs/screens.md 2章）。ログイン後、グループが1つも無いときに出す（`app/index.tsx` が回す）。
// 入力は最小限（グループ名・自分の表示名・通貨）。作ると、初期の費目（家賃など）をサーバーが作る。
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupService } from '../platform/groupService.ts';
import { newId } from '../platform/randomId.ts';
import { CURRENCIES, DEFAULT_CURRENCY_CODE, DEFAULT_GROUP_NAME } from '../src/domain/group.ts';
import { createGroupErrorMessage } from '../src/services/groupMessage.ts';
import { validateCreateGroupForm, type CreateGroupFormErrors } from '../src/services/groupForm.ts';
import { getDeviceTimeZone } from '../src/services/timeZone.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { TextField } from '../ui/TextField.tsx';
import { useColors } from '../ui/useColors.ts';

export default function CreateGroupScreen() {
  const router = useRouter();
  const colors = useColors();
  const [name, setName] = useState(DEFAULT_GROUP_NAME);
  const [displayName, setDisplayName] = useState('');
  const [currencyCode, setCurrencyCode] = useState(DEFAULT_CURRENCY_CODE);
  const [fieldErrors, setFieldErrors] = useState<CreateGroupFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // この作成の識別子。画面を開いたときに1回だけ作り、やり直しでも同じ値を送る: 通信が切れて、サーバーで作成が済んだか
  // 分からないとき、同じ `id` なら、グループが2つにならない（サーバーは、済んでいれば保存済みのグループを返す）。
  // 副作用として、結果が分からない失敗のあとに名前を直して送り直すと、すでに作られていた場合は、直す前の名前のまま
  // 進む（グループ名は、あとから変えられる）。
  const requestId = useRef<string | null>(null);

  function clearFieldError(field: keyof CreateGroupFormErrors) {
    setFieldErrors((current) => (current[field] === undefined ? current : { ...current, [field]: undefined }));
  }

  async function submit() {
    if (submitting.current) return;
    const result = validateCreateGroupForm({ name, displayName, currencyCode });
    if (!result.ok) {
      setFieldErrors(result.errors);
      setError(null);
      return;
    }
    setFieldErrors({});
    const timezone = getDeviceTimeZone();
    if (timezone === null) {
      setError('この端末のタイムゾーンを取得できませんでした。端末の日付と時刻の設定を確認してください。');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      requestId.current ??= newId();
      await groupService.createGroup({ id: requestId.current, ...result.value, timezone });
      // グループができたので、最初の画面へ戻る（そこで読み直して、ホームを出す）。
      router.replace('/');
    } catch (e) {
      setError(createGroupErrorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
            グループを作る
          </Text>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            生活費を一緒に記録するグループです。相手は、あとから招待できます。
          </Text>

          <View style={styles.form}>
            <TextField
              label="グループ名"
              value={name}
              onChangeText={(text) => {
                setName(text);
                clearFieldError('name');
              }}
              error={fieldErrors.name}
              editable={!busy}
              returnKeyType="next"
            />
            <TextField
              label="自分の表示名"
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                clearFieldError('displayName');
              }}
              placeholder="このグループの中での名前"
              error={fieldErrors.displayName}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
            />

            <View style={styles.currency}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>通貨</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {CURRENCIES.map((currency) => {
                  const selected = currency.code === currencyCode;
                  return (
                    <Pressable
                      key={currency.code}
                      accessibilityRole="radio"
                      accessibilityLabel={currency.name}
                      accessibilityState={{ selected, disabled: busy }}
                      disabled={busy}
                      onPress={() => setCurrencyCode(currency.code)}
                      style={[
                        styles.chip,
                        selected
                          ? { backgroundColor: colors.accent, borderColor: colors.accent }
                          : { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.chipLabel, { color: selected ? colors.onAccent : colors.textPrimary }]}>
                        {currency.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {fieldErrors.currencyCode ? (
                <Text style={[styles.hint, { color: colors.error }]} accessibilityRole="alert">
                  {fieldErrors.currencyCode}
                </Text>
              ) : (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  支出を登録したあとは、通貨を変えられません。
                </Text>
              )}
            </View>
          </View>
        </ScrollView>

        {/* ボタンは、画面の下に固定する（キーボードを出したままでも押せる）。失敗の文言は、その上に出す。ボタンをスクロールの
            中に置くと、文言が出るたびにボタンが下がり、直後に同じ場所を押しても外れる（docs/screens.md 2章のログイン画面と同じ理由）。 */}
        <View style={styles.footer}>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton label="作成" busy={busy} onPress={() => void submit()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, gap: 16 },
  footer: { paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  lead: { fontSize: 15, lineHeight: 22 },
  form: { gap: 20, marginTop: 8 },
  currency: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  chipLabel: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
