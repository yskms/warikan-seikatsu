// カテゴリと負担割合の一覧（設定から。`ui/settings/CategoriesScreen.tsx`）。`/categories?groupId=…`。
import { useLocalSearchParams } from 'expo-router';

import { CategoriesScreen } from '../ui/settings/CategoriesScreen.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function CategoriesRoute() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = single(params.groupId);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  return <CategoriesScreen key={groupId} groupId={groupId} />;
}
