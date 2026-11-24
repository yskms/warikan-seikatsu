// 支出の登録・編集のシート（下から出るモーダル。`ui/expense/ExpenseSheet.tsx`）。
// 登録: `/expense?groupId=…`。編集: `/expense?groupId=…&expenseId=…&month=YYYY-MM`（ホームの支出の行から）。
import { useLocalSearchParams } from 'expo-router';

import { ExpenseSheet } from '../ui/expense/ExpenseSheet.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function ExpenseRoute() {
  const params = useLocalSearchParams<{ groupId?: string; expenseId?: string; month?: string }>();
  const groupId = single(params.groupId);
  const expenseId = single(params.expenseId);
  const month = single(params.month);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  // 編集は、支出のIDと月の両方が要る（片方だけなら、登録として開かない: 別の支出を作ってしまわない）
  if ((expenseId === null) !== (month === null)) return null;
  return <ExpenseSheet key={`${groupId}/${expenseId ?? ''}`} groupId={groupId} expenseId={expenseId} month={month} />;
}
