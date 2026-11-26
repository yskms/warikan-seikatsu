// ログイン画面（docs/screens.md 2章）。AppleとGoogleの両方を、両OSで出す（iOSはAppleが上、AndroidはGoogleが上）。
// 招待URLから来たとき（`pendingInvite` を持っているとき）は、上部にログインが要る理由を出す。ログイン後は、ルート（`app/_layout.tsx`）が、
// 持っている招待を見て、参加確認（`app/join.tsx`）だけを出す（ここでは、招待を扱わない）。
import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { accountService } from '../platform/accountService.ts';
import type { AuthProvider } from '../src/domain/types.ts';
import { CONTACT_URL, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../src/legal/legalUrls.ts';
import { buildLegalLinks } from '../src/services/aboutView.ts';
import { isAlreadySignedIn, signInErrorMessage } from '../src/services/signInMessage.ts';
import { useAuth } from '../ui/AuthStateProvider.tsx';
import { clearLoginNotice, useLoginNotice } from '../ui/loginNotice.ts';
import { useColors } from '../ui/useColors.ts';
import { usePendingInvite } from '../ui/usePendingInvite.ts';

const titleImage = require('../assets/title.png') as number;

const PROVIDER_ORDER: readonly AuthProvider[] =
  Platform.OS === 'ios' ? ['apple', 'google'] : ['google', 'apple'];

// 表示名と「公開していないページは出さない」規則は、「このアプリについて」と共通（`src/services/aboutView.ts`）
const LEGAL_LINKS = buildLegalLinks({
  privacyPolicy: PRIVACY_POLICY_URL,
  termsOfService: TERMS_OF_SERVICE_URL,
  contact: CONTACT_URL,
});

export default function LoginScreen() {
  const { state, markSignedIn } = useAuth();
  const colors = useColors();
  const invited = usePendingInvite() !== null;
  // アカウントを削除したあとの案内など（`ui/loginNotice.ts`）。ログインが済むまで出す
  const notice = useLoginNotice();
  // iOSは `accessibilityLiveRegion` で読み上げないので、ここで読み上げる（Androidは、下の `accessibilityLiveRegion`）
  useEffect(() => {
    if (Platform.OS === 'ios' && notice !== null) AccessibilityInfo.announceForAccessibility(notice.join('\n'));
  }, [notice]);
  // 進行中のログイン手段。あるあいだは、どのボタンも押せない。表示用の `busy` とは別に、`ref` でも持つ: `busy` は、
  // 再描画されるまで古いままなので、続けて2回押されると、どちらの押下も `null` を見て、各社の画面が2回開きうる。
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const signingIn = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: AuthProvider) {
    if (signingIn.current) return;
    signingIn.current = true;
    setBusy(provider);
    setError(null);
    try {
      await accountService.signIn(provider);
      clearLoginNotice();
      markSignedIn();
    } catch (e) {
      // すでにサインイン済みなら、ログイン済みとして進める。取りやめは、何も出さない。
      if (isAlreadySignedIn(e)) {
        clearLoginNotice();
        markSignedIn();
      } else setError(signInErrorMessage(e, provider));
    } finally {
      signingIn.current = false;
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* 招待URLから来た人へ、上部に出す。ログイン後は、招待を持ったまま参加確認へ進む（上の説明） */}
      {invited ? (
        <Text
          style={[styles.invited, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="text"
        >
          {/* 読点で改行する（狭い画面で、「必／要です」のように中途半端に折り返さない） */}
          {'ふたりで使うには、\nデータ保護のためログインが必要です'}
        </Text>
      ) : null}
      {/* 削除の結果など。招待の案内の下に出す。`accessibilityLiveRegion` で、ログイン画面に移ったときに読み上げる */}
      {notice !== null ? (
        <View
          style={[styles.noticeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {notice.map((line) => (
            <Text key={line} style={[styles.noticeLine, { color: colors.textPrimary }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={styles.hero}>
        {/* アイコン・フィーチャーグラフィックと同じ Reggae One の字形。フォントは同梱せず（約2.1MB）、「わりかん生活」だけを
            書き出した画像を使う（約9KB）。画像は透明な地に不透明の字で、`tintColor` が字の色（ライト・ダーク）を決める。
            アプリ名を変えたら、画像を作り直す（docs/plan.md 14章の「ログイン画面のタイトル」）。読み上げは `accessibilityLabel` */}
        <Image
          source={titleImage}
          style={[styles.title, { tintColor: colors.textPrimary }]}
          resizeMode="contain"
          accessible
          accessibilityRole="header"
          accessibilityLabel="わりかん生活"
        />
        <View style={[styles.rule, { backgroundColor: colors.accent }]} />
        <Text style={[styles.tagline, { color: colors.textSecondary }]}>
          ふたりの生活費を、決めた割合で月ごとに精算
        </Text>
      </View>

      <View style={styles.actions}>
        {state.status === 'signed-out' && state.unreadable ? (
          <Text style={[styles.notice, { color: colors.textSecondary }]}>
            この端末に保存したログイン情報を読み取れませんでした。ログインし直してください。
          </Text>
        ) : null}

        {/* 失敗の文言は、ボタンの上に出す。下に出すと、ボタンが押し上げられて、直後のタップが外れる。 */}
        {error ? (
          <Text
            style={[styles.error, { color: colors.error }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
        ) : null}

        {PROVIDER_ORDER.map((provider) => (
          <ProviderButton
            key={provider}
            provider={provider}
            busy={busy === provider}
            disabled={busy !== null}
            onPress={() => void signIn(provider)}
          />
        ))}

        {LEGAL_LINKS.length > 0 ? (
          <View style={styles.legal}>
            {LEGAL_LINKS.map((link) => (
              <Pressable
                key={link.url}
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => void Linking.openURL(link.url).catch(() => {})}
              >
                <Text style={[styles.legalLink, { color: colors.textSecondary }]}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

interface ProviderButtonProps {
  provider: AuthProvider;
  busy: boolean;
  disabled: boolean;
  onPress(): void;
}

function ProviderButton({ provider, busy, disabled, onPress }: ProviderButtonProps) {
  if (provider === 'apple' && Platform.OS === 'ios') {
    return <NativeAppleButton busy={busy} disabled={disabled} onPress={onPress} />;
  }
  return <CustomButton provider={provider} busy={busy} disabled={disabled} onPress={onPress} />;
}

// iOSのAppleは、システムのボタン（Appleのガイドラインに合う見た目・文言。端末の言語に合わせて出る）。使えない端末
// （古いiOSなど）では、ふつうのボタンにする。システムのボタンには無効の状態が無いので、進行中の押下は無視する。
function NativeAppleButton({ busy, disabled, onPress }: Omit<ProviderButtonProps, 'provider'>) {
  const scheme = useColorScheme();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    AppleAuthentication.isAvailableAsync().then(
      (value) => !cancelled && setAvailable(value),
      () => !cancelled && setAvailable(false),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (available === false) return <CustomButton provider="apple" busy={busy} disabled={disabled} onPress={onPress} />;
  return (
    <View style={[styles.buttonSlot, disabled && !busy && styles.dimmed]}>
      {available ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            scheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={BUTTON_RADIUS}
          style={styles.nativeButton}
          onPress={() => {
            if (!disabled) onPress();
          }}
        />
      ) : null}
      {busy ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator color={scheme === 'dark' ? '#000000' : '#FFFFFF'} />
        </View>
      ) : null}
    </View>
  );
}

function CustomButton({ provider, busy, disabled, onPress }: ProviderButtonProps) {
  const colors = useColors();
  const scheme = useColorScheme();
  // Appleは白黒の2色（ダークでは白地に黒）。Googleは、面の色に縁をつける。
  const look =
    provider === 'apple'
      ? scheme === 'dark'
        ? { background: '#FFFFFF', text: '#000000', border: '#FFFFFF' }
        : { background: '#000000', text: '#FFFFFF', border: '#000000' }
      : { background: colors.surface, text: colors.textPrimary, border: colors.border };
  const label = provider === 'apple' ? 'Appleでサインイン' : 'Googleでログイン';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.background, borderColor: look.border },
        disabled && !busy && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={look.text} />
      ) : (
        <>
          <Ionicons name={provider === 'apple' ? 'logo-apple' : 'logo-google'} size={20} color={look.text} />
          <Text style={[styles.buttonLabel, { color: look.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTON_RADIUS = 12;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  invited: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    overflow: 'hidden',
  },
  noticeCard: { marginTop: 16, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  noticeLine: { fontSize: 14, lineHeight: 20 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  // 画像は3倍の解像度（533x82）なので、表示は 178x27（縦横比は画像と同じ）。RNは静的な画像に、原寸の幅・高さを下敷きとして
  // 与えるので、幅だけ・`aspectRatio` だけの指定では、残りが原寸のままになる。幅・高さの両方を指定する
  title: { width: 178, height: 27 },
  rule: { width: 40, height: 4, borderRadius: 2 },
  tagline: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  actions: { gap: 12, paddingBottom: 16 },
  notice: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: {
    height: 50,
    borderRadius: BUTTON_RADIUS,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonLabel: { fontSize: 17, fontWeight: '600' },
  buttonSlot: { height: 50 },
  nativeButton: { width: '100%', height: 50 },
  busyOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  error: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  legal: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 8 },
  legalLink: { fontSize: 13, textDecorationLine: 'underline' },
});
