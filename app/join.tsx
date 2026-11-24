// 招待URLを開いたあとの参加確認（docs/screens.md 2章。`ui/join/JoinScreen.tsx`）。`ui/GroupGate.tsx` が、保持した招待
// （`platform/inviteLink.ts` の `pendingInvite`）を見て、ここへ回す。トークンは、画面のパラメーターに載せず、保持した招待から読む
// （ナビゲーションの状態・URLに、トークンを残さない）。
import { Redirect } from 'expo-router';

import { JoinScreen } from '../ui/join/JoinScreen.tsx';
import { usePendingInvite } from '../ui/usePendingInvite.ts';

export default function JoinRoute() {
  const token = usePendingInvite();
  // 招待を手放したら（参加した・キャンセルした・すでに参加中だった・使えない招待を閉じた）、最初の画面へ戻る。
  // そこで、グループの一覧を読み直して、メイン（またはグループの作成）へ進む。
  if (token === null) return <Redirect href="/" />;
  // 確認の最中に、別の招待URLが開かれたら、その招待の確認へ切り替える（`key`。入力も状態も作り直す）
  return <JoinScreen key={token} token={token} />;
}
