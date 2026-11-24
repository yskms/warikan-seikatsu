// 招待URLの受け取り。アプリに渡されたURL（起動したときと、起動中に開かれたとき）が招待URLなら、トークンを `pendingInvite` に
// 持つ（`src/services/inviteLink.ts`・`pendingInvite.ts`）。RN（Linking）を import するので、Nodeのテストから実行する `src/` には
// 置かない（CLAUDE.md）。
//
// **メインの画面は、ログインしていない人には出ない**（`Stack.Protected`）ので、招待URLで起動した未ログインの人の行き先は、何もしなければ
// 残らない（URLは捨てられる）。そこで、expo-router とは別に、ここでURLを受け取って持っておき、ルート（`app/_layout.tsx` の
// `RootNavigator`）が、招待を持っているあいだ、参加確認（`app/join.tsx`）だけを出す。expo-router には、招待URLを画面として渡さない
// （`app/+native-intent.tsx`）。
//
// 起動したときのURL（`getInitialURL`）は、読み終えるまで `linksReady` が偽: 読み終える前にログイン後の画面が動くと、招待された人が、
// 作る必要のないグループの作成画面へ回されうる。`app/_layout.tsx` が、読み終えるまでスプラッシュを出したままにする。
//
// **`getInitialURL` は、ルートがマウントされるたびに読み直す**（`startInviteLinks`。`app/_layout.tsx` の `RootLayout` の、依存が `[]` の `useEffect`。描画のたびではない。毎回読む必要は無いので、依存を足さない）。
// Androidでは、戻る操作でアプリを閉じても（Activityが終わる）、プロセスは残る。そのあとに招待URLを開くと、新しいActivityが
// 作られ、JSの実行環境はそのまま使われる。このとき `url` イベントは届かない（`onNewIntent` を通らない）ので、`getInitialURL`
// を読み直さないと、招待を取りこぼす（エミュレータで、戻る操作のあとに招待URLを開いて確かめた）。新しいActivityでは、ルートが
// マウントし直されるので、その `useEffect` で読み直す。
// 副作用（未確認。Androidの仕様からの推測）: システムが同じActivityを作り直したとき（最近使ったアプリから開き直したときを含む）、そのActivityを起動したURLが
// また読まれ、**手放した招待が、もう一度、参加確認に出ることがある**（参加済みなら、確認を出さずにそのグループを開く。
// キャンセルしたものは、もう一度出る。使えない招待は、「使えません」の案内）。新しく開いたURLと区別できない（Intentに識別子が無い）ので、
// 手放した招待を覚えて捨てる形にはしない（開き直したURLを無視するほうが悪い）。
// 最近使ったアプリからの起動は、`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` で見分けられる可能性があるが、JSからは読めない（docs/screens.md 2章）。
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

let listening = false;

/**
 * URLの受け取りを始める。**ルートがマウントされるたびに呼ぶ**（上の説明。`url` イベントの購読は、1回だけ）。
 * 起動したときのURLは、時間切れ（上限）のあとに届いても受け取る（ルート（`app/_layout.tsx`）が、招待を持った時点で、どの画面にいても、
 * 参加確認へ移すので、あとから届いても間に合う）。
 */
export function startInviteLinks(): void {
  try {
    if (!listening) {
      listening = true;
      // アプリの生きているあいだ受け取り続けるので、解除しない
      Linking.addEventListener('url', ({ url }) => accept(url));
    }
    const initial = Linking.getInitialURL();
    // 時間切れのあとに届いても受け取る
    initial.then(accept, () => {});
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), INITIAL_URL_TIMEOUT_MS));
    Promise.race([initial, timeout])
      .catch(() => {})
      .finally(() => linksReady.set(true));
  } catch {
    // URLを受け取れなくても、アプリは起動する（招待URLを開いても、参加確認へは進まない）。スプラッシュを止め続けない
    linksReady.set(true);
  }
}
