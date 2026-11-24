// 締めた月の支出の、読み取り専用の表示（docs/screens.md 4章）。キーパッド・保存・削除は出さない。
// 負担の方法は、種類だけを言葉で出す（メンバーごとの負担額は、ホームの内訳が正で、ここでは計算しない）。
import { StyleSheet, Text, View } from 'react-native';

import type { ExpenseFormContext } from '../../src/services/expenseForm.ts';
import { formatMonth, formatExpenseDate } from '../../src/services/dateFormat.ts';
import { formatMoney } from '../../src/services/money.ts';
import { useColors } from '../useColors.ts';

const SPLIT_LABELS: Record<string, string> = {
  category: 'カテゴリの割合で分けています',
  ratio: 'この支出だけ、割合で分けています',
  equal: 'この支出だけ、均等に分けています',
  fixed: 'この支出だけ、金額を指定して分けています',
  single: 'この支出だけ、1人が全額負担しています',
};

export function ReadOnlyExpense({ ctx }: { ctx: ExpenseFormContext }) {
  const colors = useColors();
  const expense = ctx.editing;
  if (expense === null) return null;
  const category = ctx.categories.find((item) => item.id === expense.categoryId);
  const payer = ctx.members.find((item) => item.id === expense.payerMemberId);
  const rows: [string, string][] = [
    ['金額', formatMoney(expense.amountMinor, ctx.currencyCode, ctx.minorUnit)],
    ['カテゴリ', category?.name ?? '（不明なカテゴリ）'],
    ['支払った人', payer?.displayName ?? '（不明なメンバー）'],
    ['日付', formatExpenseDate(expense.expenseDate)],
    ['登録した月', formatMonth(expense.targetMonth)],
    ['内容', expense.description ?? 'なし'],
    ['負担の分け方', SPLIT_LABELS[expense.splitMethod] ?? 'この支出だけ、負担を変えています'],
  ];
  return (
    <View style={styles.box}>
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        締めた月の支出は、変更できません。
      </Text>
      {rows.map(([label, value]) => (
        <View key={label} accessible accessibilityLabel={`${label}、${value}`} style={[styles.row, { borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
          <Text style={[styles.value, { color: colors.textPrimary }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  note: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  value: { fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
