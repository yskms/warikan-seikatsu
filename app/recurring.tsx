// 固定費の一覧（設定から。`ui/settings/RecurringScreen.tsx`）。`/recurring?groupId=…`。
import { useLocalSearchParams } from 'expo-router';

import { RecurringScreen } from '../ui/settings/RecurringScreen.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function RecurringRoute() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = single(params.groupId);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  return <RecurringScreen key={groupId} groupId={groupId} />;
}
