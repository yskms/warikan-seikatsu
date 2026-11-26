// ホームの上の部分（docs/screens.md 3章）: お知らせ、その月の支出の総額、メンバー別の負担額、内訳。
// 表示する文言・金額は、`src/services/homeView.ts` が組み立てたものを並べるだけ（ここでは計算しない）。
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  memberColumns,
  type Breakdown,
  type InviteCard,
  type MemberBurden,
  type TotalModel,
} from '../../src/services/homeView.ts';
import { useColors } from '../useColors.ts';
import { Avatar } from './Avatar.tsx';
import { CategoryIcon } from './CategoryIcon.tsx';

/** ホームのお知らせの1つ（月のお知らせ・固定費のお知らせを、同じ形で並べる） */
export interface NoticeItem {
  /** 重ならない識別子 */
  key: string;
  message: string;
  /** スクリーンリーダー向けの、タップしたときに起きることの説明 */
  hint: string;
  onPress(): void;
  /** お知らせの下に出す、本文のタップとは別の操作（「確認した」「均等にする」など。上から並べる）。無ければ、お知らせ全体がタップの対象 */
  actions?: readonly NoticeAction[];
  /** `actions` の操作が失敗した文言（操作の上に出す） */
  error?: string | null;
}

export interface NoticeAction {
  label: string;
  /** スクリーンリーダー向けの、押したときに起きることの説明 */
  hint: string;
  /** 通信の最中。押せなくする（同じお知らせの操作は、どれも押せなくする） */
  busy: boolean;
  onPress(): void;
}

/** お知らせ。複数あれば重ねて出す。タップで何が起きるかは、呼ぶ側が決める（月へ移る・固定費を開く）。 */
export function NoticeList({ notices }: { notices: readonly NoticeItem[] }) {
  const colors = useColors();
  if (notices.length === 0) return null;
  return (
    <View style={styles.notices}>
      {notices.map((notice) => {
        // 地の色（accent）は白の上で文字に足りないので、枠と面で目立たせ、文字は本文の色にする
        const box = { backgroundColor: colors.surface, borderColor: colors.accent };
        const body = (
          <>
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.textPrimary} />
            <Text style={[styles.noticeText, { color: colors.textPrimary }]}>{notice.message}</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </>
        );
        const { actions } = notice;
        if (actions === undefined || actions.length === 0) {
          return (
            <Pressable
              key={notice.key}
              accessibilityRole="button"
              accessibilityLabel={notice.message}
              accessibilityHint={notice.hint}
              onPress={notice.onPress}
              style={[styles.notice, box]}
            >
              {body}
            </Pressable>
          );
        }
        // 操作が2つあるお知らせ: 本文（タップで開く）と、下の操作を、別のボタンにする（ボタンの中にボタンを入れない）
        return (
          <View key={notice.key} style={[styles.noticeBox, box]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={notice.message}
              accessibilityHint={notice.hint}
              onPress={notice.onPress}
              style={styles.noticeRow}
            >
              {body}
            </Pressable>
            {notice.error !== null && notice.error !== undefined ? (
              <Text style={[styles.noticeError, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {notice.error}
              </Text>
            ) : null}
            <View style={styles.noticeActions}>
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  accessibilityHint={action.hint}
                  accessibilityState={{ disabled: action.busy, busy: action.busy }}
                  disabled={action.busy}
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.noticeAction,
                    { borderColor: colors.border, opacity: action.busy ? 0.5 : 1 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.noticeActionText, { color: colors.textPrimary }]}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * 1人だけのグループの「相手を招待する」カード。タップで、メンバーと招待の画面を開く（ここでは発行しない。`buildInviteCard`）。
 * お知らせと同じ枠で目立たせる。
 */
export function InviteCardView({ card, onPress }: { card: InviteCard; onPress(): void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}。${card.message}`}
      accessibilityHint="タップすると、招待URLを作る画面を開きます"
      onPress={onPress}
      style={({ pressed }) => [
        styles.notice,
        { backgroundColor: colors.surface, borderColor: colors.accent },
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons name="account-plus-outline" size={26} color={colors.textPrimary} />
      <View style={styles.inviteBody}>
        <Text style={[styles.noticeText, { color: colors.textPrimary }]}>{card.title}</Text>
        <Text style={[styles.inviteMessage, { color: colors.textSecondary }]}>{card.message}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

/** その月の支出の総額（いちばん大きく出す）。繰越は含めない。 */
export function TotalCard({ total }: { total: TotalModel }) {
  const colors = useColors();
  return (
    <View style={styles.total}>
      <View style={styles.totalTitleRow}>
        <Text style={[styles.totalTitle, { color: colors.textSecondary }]}>{total.title}</Text>
        {total.closedBadge ? (
          <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.badgeText, { color: colors.textPrimary }]}>{total.closedBadge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.totalAmount, { color: colors.textPrimary }]}
        accessibilityLabel={`${total.title} ${total.amountText}`}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {total.amountText}
      </Text>
    </View>
  );
}

/** メンバー別の負担額（3人までは横一列、4人以上は折り返す）。 */
export function MemberBurdens({ items }: { items: MemberBurden[] }) {
  const colors = useColors();
  const columns = memberColumns(items.length);
  return (
    <View style={styles.burdens}>
      {items.map((item) => (
        <View
          key={item.memberId}
          accessible
          accessibilityLabel={`${item.name} ${item.burdenText}`}
          style={[styles.burdenCell, { width: `${100 / columns}%` }]}
        >
          <Avatar initial={item.initial} color={item.color} size={40} />
          <Text style={[styles.burdenName, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.burdenAmount, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
            {item.burdenText}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 内訳（折りたたみ）。メンバーごとの支払額・負担額・差額・繰越と、費目ごとの合計・負担割合・負担額。`onOpenCategory` を渡すと
 * （締めていない月）、費目の見出しを押して、その費目の編集を開ける。
 */
export function BreakdownSection({
  breakdown,
  onOpenCategory,
}: {
  breakdown: Breakdown;
  onOpenCategory?: (categoryId: string) => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="内訳を見る"
        hitSlop={8}
        onPress={() => setOpen((value) => !value)}
        style={styles.toggle}
      >
        <Text style={[styles.toggleLabel, { color: colors.textSecondary }]}>内訳を見る</Text>
        <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
      </Pressable>

      {open ? (
        <View style={[styles.breakdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {breakdown.members.map((member) => (
            <View key={member.memberId} style={styles.breakdownBlock}>
              <Text style={[styles.breakdownHeading, { color: colors.textPrimary }]}>{member.name}</Text>
              <Line label="支払額" value={member.paidText} />
              <Line label="負担額" value={member.burdenText} />
              <Line label="差額" value={member.differenceText} />
              {member.carriedInText ? <Line label="繰越" value={member.carriedInText} /> : null}
            </View>
          ))}

          {breakdown.categories.length > 0 ? (
            <View style={[styles.breakdownBlock, styles.categoriesBlock, { borderColor: colors.border }]}>
              <Text style={[styles.breakdownHeading, { color: colors.textPrimary }]}>費目ごと</Text>
              {breakdown.categories.map((category) => {
                // 費目の一覧に無い費目（`known` が false）は、開く先が無い
                const openCategory =
                  onOpenCategory !== undefined && category.known ? () => onOpenCategory(category.categoryId) : null;
                const head = (
                  <>
                    <View style={styles.lineRow}>
                      {/* 押せる費目には、名前の横に矢印を出す（金額の列を、負担額の行と揃えるため、右端には置かない） */}
                      <View style={styles.categoryName}>
                        <Text style={[styles.lineLabel, { color: colors.textPrimary }]}>{category.name}</Text>
                        {openCategory !== null ? (
                          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
                        ) : null}
                      </View>
                      <Text style={[styles.lineValue, { color: colors.textPrimary }]}>{category.totalText}</Text>
                    </View>
                    {category.shareText !== null ? (
                      <Text style={[styles.shareText, { color: colors.textSecondary }]}>{category.shareText}</Text>
                    ) : null}
                  </>
                );
                return (
                  <View key={category.categoryId} style={styles.categoryRow}>
                    <CategoryIcon icon={category.icon} color={category.color} size={28} />
                    <View style={styles.categoryBody}>
                      {openCategory !== null ? (
                        // 見出し（費目・合計・割合）だけを押せる。負担額の行は、読み上げが隠れないよう、押せる範囲に入れない
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={[category.name, category.totalText, category.shareText].filter((t) => t !== null).join('、')}
                          accessibilityHint="この費目の負担割合などを編集します"
                          hitSlop={4}
                          onPress={openCategory}
                          style={({ pressed }) => [styles.categoryHead, pressed && styles.pressed]}
                        >
                          {head}
                        </Pressable>
                      ) : (
                        <View style={styles.categoryHead}>{head}</View>
                      )}
                      {category.burdens.map((burden) => (
                        <View key={burden.memberId} style={styles.lineRow}>
                          <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>{burden.name}の負担</Text>
                          <Text style={[styles.lineValue, { color: colors.textSecondary }]}>{burden.burdenText}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.lineRow}>
      <Text style={[styles.lineLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notices: { gap: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 14 },
  noticeText: { flex: 1, fontSize: 15, fontWeight: '600' },
  noticeBox: { gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 14 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeError: { fontSize: 13, lineHeight: 18 },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  noticeAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 10 },
  noticeActionText: { fontSize: 14, fontWeight: '600' },
  inviteBody: { flex: 1, gap: 2 },
  inviteMessage: { fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7 },

  total: { gap: 4, paddingVertical: 8 },
  totalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  totalTitle: { fontSize: 15, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  totalAmount: { fontSize: 40, fontWeight: '800' },

  burdens: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  burdenCell: { alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  burdenName: { fontSize: 14 },
  burdenAmount: { fontSize: 20, fontWeight: '700', maxWidth: '100%' },

  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 36 },
  toggleLabel: { fontSize: 14, fontWeight: '600' },
  breakdown: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 14, marginTop: 4 },
  breakdownBlock: { gap: 4 },
  categoriesBlock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, gap: 10 },
  breakdownHeading: { fontSize: 15, fontWeight: '700' },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineLabel: { fontSize: 14, flexShrink: 1 },
  lineValue: { fontSize: 14, fontWeight: '600' },
  categoryRow: { flexDirection: 'row', gap: 10 },
  categoryBody: { flex: 1, gap: 2 },
  categoryHead: { gap: 2 },
  categoryName: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 2 },
  shareText: { fontSize: 13, lineHeight: 18 },
});
