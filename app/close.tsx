// 月を締める前の確認のシート（docs/screens.md 5章）。下から出るモーダル（`ui/close/CloseSheet.tsx`）。
// `/close?groupId=…&month=YYYY-MM`（ホームの精算のカードの「この月を締める」から）。
import { useLocalSearchParams } from 'expo-router';

import { CloseSheet } from '../ui/close/CloseSheet.tsx';

function single(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}

export default function CloseRoute() {
  const params = useLocalSearchParams<{ groupId?: string; month?: string }>();
  const groupId = single(params.groupId);
  const month = single(params.month);
  // どちらかが分からないときは、何も出さない（アプリ内の遷移からは、必ず付く）。月の形は、読み込むときにRepositoryが検べる
  if (groupId === null || month === null) return null;
  return <CloseSheet key={`${groupId}/${month}`} groupId={groupId} month={month} />;
}
