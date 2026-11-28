// 招待URLを貼り付けて参加確認へ進む画面（グループ作成の「招待を受け取った方はこちら」から。`ui/join/JoinByUrlScreen.tsx`）。`/join-by-url`。
// 招待URLをタップして開く経路（`app/join.tsx`。招待を持っているあいだ、ルートが出す参加確認）とは別。
import { JoinByUrlScreen } from '../ui/join/JoinByUrlScreen.tsx';

export default function JoinByUrlRoute() {
  return <JoinByUrlScreen />;
}
