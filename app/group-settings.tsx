// グループの設定（設定から。`ui/settings/GroupSettingsScreen.tsx`）。`/group-settings?groupId=…`。
import { useLocalSearchParams } from 'expo-router';

import { GroupSettingsScreen } from '../ui/settings/GroupSettingsScreen.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function GroupSettingsRoute() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = single(params.groupId);
  // グループが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）
  if (groupId === null) return null;
  return <GroupSettingsScreen key={groupId} groupId={groupId} />;
}
