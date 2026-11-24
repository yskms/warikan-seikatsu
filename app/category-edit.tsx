// カテゴリの追加・編集のシート（下から出るモーダル。`ui/settings/CategoryEditSheet.tsx`）。
// 追加: `/category-edit?groupId=…&month=YYYY-MM`。編集: `/category-edit?groupId=…&categoryId=…&month=YYYY-MM`（一覧の行から）。
// `month` は、負担割合を出している月（無くてもよい: 締めていない月が無いとき）。
import { useLocalSearchParams } from 'expo-router';

import { CategoryEditSheet } from '../ui/settings/CategoryEditSheet.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function CategoryEditRoute() {
  const params = useLocalSearchParams<{ groupId?: string; categoryId?: string; month?: string }>();
  const groupId = single(params.groupId);
  const categoryId = single(params.categoryId);
  const month = single(params.month);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  return <CategoryEditSheet key={`${groupId}/${categoryId ?? ''}`} groupId={groupId} categoryId={categoryId} month={month} />;
}
