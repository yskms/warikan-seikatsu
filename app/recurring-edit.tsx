// 固定費の登録・編集のシート（下から出るモーダル。`ui/settings/RecurringEditSheet.tsx`）。
// 登録: `/recurring-edit?groupId=…`。編集: `/recurring-edit?groupId=…&recurringId=…`（一覧の行から）。
import { useLocalSearchParams } from 'expo-router';

import { RecurringEditSheet } from '../ui/settings/RecurringEditSheet.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function RecurringEditRoute() {
  const params = useLocalSearchParams<{ groupId?: string; recurringId?: string }>();
  const groupId = single(params.groupId);
  const recurringId = single(params.recurringId);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  return <RecurringEditSheet key={`${groupId}/${recurringId ?? ''}`} groupId={groupId} recurringId={recurringId} />;
}
