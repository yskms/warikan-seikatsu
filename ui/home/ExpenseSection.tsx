// 支出の一覧（docs/screens.md 3章）。その月の支出を全件、サーバーの並び（日付の新しい順）で出す。
// 行をタップすると、編集のシートを開く（詳細は挟まない。締めた月は、読み取り専用で開く。`ui/expense/ExpenseSheet.tsx`）。
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ExpenseRow } from '../../src/services/homeView.ts';
import { useColors } from '../useColors.ts';
import { CategoryIcon } from './CategoryIcon.tsx';

export function ExpenseSection({ rows, onOpen }: { rows: ExpenseRow[]; onOpen(expenseId: string): void }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: colors.textPrimary }]} accessibilityRole="header">
        支出
      </Text>
      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>＋から支出を登録できます。</Text>
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityHint="押すと、この支出を開きます"
            onPress={() => onOpen(row.id)}
            accessibilityLabel={`${row.title}、${row.subtitle}、${row.amountText}${row.badges.length > 0 ? `、${row.badges.join('、')}` : ''}`}
            style={({ pressed }) => [styles.row, { borderColor: colors.border }, pressed && styles.pressed]}
          >
            <CategoryIcon icon={row.icon} color={row.color} />
            <View style={styles.body}>
              <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
                {row.title}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                {row.subtitle}
              </Text>
              {row.badges.length > 0 ? (
                <View style={styles.badges}>
                  {row.badges.map((badge) => (
                    <View key={badge} style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{badge}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={[styles.amount, { color: colors.textPrimary }]}>{row.amountText}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 4 },
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  amount: { fontSize: 18, fontWeight: '700' },
});
