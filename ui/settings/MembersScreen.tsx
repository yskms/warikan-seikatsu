// メンバーと招待（設定の中。docs/screens.md 6章）。メンバーの一覧と状態、招待URLの発行と共有、自分が発行した未使用の招待の
// 一覧と取り消し。**脱退を選ぶ操作・招待を開いて参加する側は、まだ作っていない**（脱退は、Workerの `summary` に「締めるとグループが
// 消える」値を足してから。screens.md 5章の「脱退を選ぶ操作を作る前に決めること」）。
//
// 出す内容の組み立ては、画面の外の `src/services/memberView.ts`（`npm test` で守る）。この画面は、それを並べるだけ。招待できるかは
// サーバーの `canInvite` で決め、人数の判定は書き写さない。
//
// - 画面を開いたとき・戻ったとき（`useFocusEffect`）・引っ張ったときに、グループ（メンバー）と招待の一覧を読み直す。読み直しの失敗は、
//   表示中の内容を残して知らせる。新しく始めた読み込みが古いものを追い越し、古い応答は捨てる。
// - **招待のトークンは、発行した応答でしか分からない**（サーバーはハッシュだけを持つ）。この画面を開いているあいだだけ、発行した招待の
//   トークンをメモリに持ち、一覧の「共有」でURLを出し直せるようにする。画面を閉じると失われる（取り消して、新しく発行する）。
// - 操作（発行・共有・取り消し）は、同時に1つだけ。失敗の文言は、「招待URLを作って共有する」ボタンの**すぐ下**に出す。この画面は
//   上から並ぶスクロールなので、上に出すと、文言の高さの分だけボタンが下がり、続けて押したタップが外れる（下端に固定した
//   ボタンの画面〔ログイン・グループ作成〕は、逆に、上に出す）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { inviteService } from '../../platform/inviteService.ts';
import type { MembersData } from '../../src/services/inviteService.ts';
import { loadHomeErrorMessage } from '../../src/services/homeMessage.ts';
import {
  issueInviteErrorMessage,
  resultUnknown,
  revokeInviteErrorMessage,
  shouldReloadAfter,
  SHARE_FAILED_MESSAGE,
} from '../../src/services/inviteMessage.ts';
import { inviteShareMessage, inviteUrl } from '../../src/services/inviteUrl.ts';
import {
  buildInviteSection,
  buildMemberList,
  formatInviteExpiry,
  sortInvites,
  type MemberRow,
} from '../../src/services/memberView.ts';
import { Avatar } from '../home/Avatar.tsx';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: MembersData };

type Busy = { kind: 'issue' } | { kind: 'share' } | { kind: 'revoke'; inviteId: string } | null;

export function MembersScreen({ groupId }: { groupId: string }) {
  const colors = useColors();
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  // 読み直しの失敗（表示中の内容は残す）と、操作の失敗
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // この画面で発行した招待のトークン（招待のID → トークン）。一覧の「共有」で、URLを出し直すため。画面を閉じると失われる
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  // 操作の同時実行を止める（state は次の描画まで変わらないので、続けて押されたときのために、同期して見られる印を持つ）
  const busyRef = useRef(false);
  // 古い応答を捨てる印。表示できる内容があるか（読み直しの失敗の出し方を分ける）
  const requestSeq = useRef(0);
  const hasData = useRef(false);

  const reload = useCallback(async () => {
    const seq = (requestSeq.current += 1);
    try {
      const data = await inviteService.load(groupId);
      if (seq !== requestSeq.current) return;
      hasData.current = true;
      setLoad({ status: 'ready', data });
      setRefreshError(null);
      // 期限が切れた・使われた・取り消された招待のトークンは、持っていても使えない
      const alive = new Set(data.invites.map((invite) => invite.id));
      setTokens((current) => Object.fromEntries(Object.entries(current).filter(([id]) => alive.has(id))));
    } catch (e) {
      if (seq !== requestSeq.current) return;
      const message = loadHomeErrorMessage(e);
      // 表示中の内容があれば、残して知らせる。無ければ、読み込みの失敗の表示
      if (hasData.current) setRefreshError(message);
      else setLoad({ status: 'error', message });
    }
  }, [groupId]);

  // 画面を開いたときと、戻ったときに読み直す
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function pullToRefresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  /** 操作を1つだけ走らせる。走っているあいだは、他の操作を受け付けない。 */
  async function exclusive(next: Exclude<Busy, null>, run: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(next);
    setActionError(null);
    try {
      await run();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  /** 共有シートを開く。開けなかったときは、文言を出す（招待は、できている）。 */
  async function openShare(token: string) {
    try {
      await Share.share({ message: inviteShareMessage(inviteUrl(token)) });
    } catch {
      setActionError(SHARE_FAILED_MESSAGE);
    }
  }

  function issue() {
    void exclusive({ kind: 'issue' }, async () => {
      let issued;
      try {
        issued = await inviteService.issue(groupId);
      } catch (e) {
        setActionError(issueInviteErrorMessage(e));
        // 状態が変わったとき（満員・脱退の確定）と、結果が分からないとき（招待ができているかもしれない）は、読み直す
        if (shouldReloadAfter(e, 'issue') || resultUnknown(e)) void reload();
        return;
      }
      setTokens((current) => ({ ...current, [issued.id]: issued.token }));
      void reload();
      setBusy({ kind: 'share' });
      await openShare(issued.token);
    });
  }

  function share(inviteId: string) {
    const token = tokens[inviteId];
    if (token === undefined) return;
    void exclusive({ kind: 'share' }, () => openShare(token));
  }

  function confirmRevoke(inviteId: string) {
    if (busyRef.current) return;
    Alert.alert('招待を取り消しますか？', '送った招待URLは、使えなくなります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '取り消す', style: 'destructive', onPress: () => revoke(inviteId) },
    ]);
  }

  function revoke(inviteId: string) {
    void exclusive({ kind: 'revoke', inviteId }, async () => {
      try {
        await inviteService.revoke(inviteId);
      } catch (e) {
        setActionError(revokeInviteErrorMessage(e));
        if (shouldReloadAfter(e, 'revoke')) void reload();
        return;
      }
      void reload();
    });
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  const view = useMemo(() => {
    if (load.status !== 'ready') return null;
    const { group, invites } = load.data;
    return {
      members: buildMemberList(group.members),
      invite: buildInviteSection(group),
      invites: sortInvites(invites),
    };
  }, [load]);

  const now = Date.now();
  const hasUnshareable = view !== null && view.invites.some((invite) => tokens[invite.id] === undefined);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="戻る" hitSlop={8} onPress={goBack} style={styles.back}>
          <MaterialCommunityIcons name="chevron-left" size={30} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">
          メンバーと招待
        </Text>
      </View>

      {load.status === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" />
        </View>
      ) : load.status === 'error' ? (
        <View style={styles.centered}>
          <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert">
            {load.message}
          </Text>
          <PrimaryButton label="もう一度" onPress={() => void reload()} />
        </View>
      ) : view !== null ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} />}
        >
          {refreshError !== null ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {refreshError}
            </Text>
          ) : null}

          <View style={styles.block}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
              メンバー
            </Text>
            <View>
              {view.members.current.map((row) => (
                <MemberRowView key={row.id} row={row} />
              ))}
            </View>
          </View>

          {view.members.former.length > 0 ? (
            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                以前のメンバー
              </Text>
              <View style={styles.dimmed}>
                {view.members.former.map((row) => (
                  <MemberRowView key={row.id} row={row} />
                ))}
              </View>
            </View>
          ) : null}

          {view.invite.visible ? (
            <View style={styles.block}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                招待
              </Text>
              <PrimaryButton
                label="招待URLを作って共有する"
                busy={busy?.kind === 'issue'}
                disabled={!view.invite.canInvite || busy !== null}
                onPress={issue}
              />
              {actionError !== null ? (
                <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {actionError}
                </Text>
              ) : null}
              {view.invite.note !== null ? (
                <Text style={[styles.note, { color: colors.textSecondary }]}>{view.invite.note}</Text>
              ) : null}
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                招待URLは、発行から3日間有効です。1人が参加すると、そのURLは使えなくなります。
              </Text>

              {view.invites.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]} accessibilityRole="header">
                    使っていない招待
                  </Text>
                  <View>
                    {view.invites.map((invite) => (
                      <View key={invite.id} style={[styles.inviteRow, { borderBottomColor: colors.border }]}>
                        <MaterialCommunityIcons name="link-variant" size={22} color={colors.textSecondary} />
                        <Text style={[styles.inviteExpiry, { color: colors.textPrimary }]} numberOfLines={1}>
                          {formatInviteExpiry(invite.expiresAt, now)}
                        </Text>
                        {tokens[invite.id] !== undefined ? (
                          <InviteAction label="共有" disabled={busy !== null} onPress={() => share(invite.id)} />
                        ) : null}
                        <InviteAction
                          label="取り消す"
                          busy={busy?.kind === 'revoke' && busy.inviteId === invite.id}
                          disabled={busy !== null}
                          onPress={() => confirmRevoke(invite.id)}
                        />
                      </View>
                    ))}
                  </View>
                  {hasUnshareable ? (
                    <Text style={[styles.note, { color: colors.textSecondary }]}>
                      URLを出し直せるのは、発行したときの画面だけです。出し直せない招待は、取り消して、新しく発行してください。
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function MemberRowView({ row }: { row: MemberRow }) {
  const colors = useColors();
  const label = `${row.name}${row.isMe ? '（あなた）' : ''}${row.statusLabel !== null ? `、${row.statusLabel}` : ''}`;
  return (
    <View accessible accessibilityLabel={label} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
      <Avatar initial={row.initial} color={row.color} size={40} />
      <View style={styles.memberBody}>
        <Text style={[styles.memberName, { color: colors.textPrimary }]} numberOfLines={1}>
          {row.name}
          {row.isMe ? <Text style={[styles.me, { color: colors.textSecondary }]}>（あなた）</Text> : null}
        </Text>
        {row.statusLabel !== null ? (
          <Text style={[styles.memberStatus, { color: colors.textSecondary }]}>{row.statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

function InviteAction({ label, onPress, disabled, busy = false }: { label: string; onPress(): void; disabled: boolean; busy?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { borderColor: colors.border, backgroundColor: colors.surface }, (disabled && !busy) && styles.dimmedAction, pressed && styles.pressed]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4, gap: 4 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  centered: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 24 },
  block: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  memberBody: { flex: 1, gap: 2 },
  memberName: { fontSize: 16, fontWeight: '600' },
  me: { fontSize: 14, fontWeight: '400' },
  memberStatus: { fontSize: 13, lineHeight: 18 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  inviteExpiry: { flex: 1, fontSize: 15 },
  action: { minWidth: 64, height: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 14, fontWeight: '600' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
  dimmedAction: { opacity: 0.5 },
});
