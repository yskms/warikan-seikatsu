// 招待URLの受け取り。アプリに渡されたURL（起動したときと、起動中に開かれたとき）が招待URLなら、トークンを `pendingInvite` に
// 持つ（`src/services/inviteLink.ts`・`pendingInvite.ts`）。RN（Linking）を import するので、Nodeのテストから実行する `src/` には
// 置かない（CLAUDE.md）。
//
// **メインの画面は、ログインしていない人には出ない**（`Stack.Protected`）ので、招待URLで起動した未ログインの人の行き先は、何もしなければ
// 残らない（URLは捨てられる）。そこで、expo-router とは別に、ここでURLを受け取って持っておき、ログイン後の分岐（`ui/GroupGate.tsx`）が
// 見て、参加確認（`app/join.tsx`）へ回す。expo-router には、招待URLを画面として渡さない（`app/+native-intent.tsx`）。
//
// 起動したときのURL（`getInitialURL`）は、読み終えるまで `linksReady` が偽: 読み終える前にログイン後の分岐が動くと、招待された人が、
// 作る必要のないグループの作成画面へ回されうる。`app/_layout.tsx` が、読み終えるまでスプラッシュを出したままにする。
// `getInitialURL` は、プロセスの生きているあいだ同じURLを返すので、起動時に1回だけ読む（その後の招待は `url` イベントで届く）。
import { Linking } from 'react-native';

import { parseInviteLink } from '../src/services/inviteLink.ts';
import { createPendingInvite } from '../src/services/pendingInvite.ts';
import { createValueStore } from '../src/services/valueStore.ts';

/** 参加の確認を待っている招待のトークン（メモリだけ。端末には保存しない） */
export const pendingInvite = createPendingInvite();

/** 起動したときのURLを、読み終えたか（読めなかった・時間切れも、読み終えたとみなす） */
export const linksReady = createValueStore(false);

// 起動したときのURLを待つ上限。Androidでは、起動のIntentから読むだけで、すぐに返る。返らなくても、スプラッシュを止め続けない
const INITIAL_URL_TIMEOUT_MS = 2000;

function accept(url: string | null): void {
  if (url === null) return;
  const token = parseInviteLink(url);
  if (token !== null) pendingInvite.set(token);
}

let started = false;

/** URLの受け取りを始める（`app/_layout.tsx` のモジュールの先頭で、1回だけ呼ぶ。2回目以降は何もしない）。 */
export function startInviteLinks(): void {
  if (started) return;
  started = true;
  // アプリの生きているあいだ受け取り続けるので、解除しない
  Linking.addEventListener('url', ({ url }) => accept(url));
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), INITIAL_URL_TIMEOUT_MS));
  Promise.race([Linking.getInitialURL(), timeout])
    .then(accept)
    .catch(() => {})
    .finally(() => linksReady.set(true));
}
