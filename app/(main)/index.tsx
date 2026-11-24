// ホーム（下のナビの1つ目。`ui/home/HomeScreen.tsx`）。いま開いているグループは `CurrentGroup`（`ui/GroupGate.tsx`）。
import { useCurrentGroup } from '../../ui/CurrentGroup.tsx';
import { HomeScreen } from '../../ui/home/HomeScreen.tsx';

export default function HomeRoute() {
  const group = useCurrentGroup();
  return <HomeScreen groupId={group.id} groupName={group.name} />;
}
