import { redirectSystemPath as redirect } from '../src/repositories/appleWebSignInRepository';
import { parseInviteLink } from '../src/services/inviteLink';

// アプリに渡されたURLを、expo-router に渡す前に直す。外さない。
// AndroidのAppleログイン（Web経由）は、Custom Tab のあと、`warikan-seikatsu://auth/apple?code=…&state=…` でアプリへ戻る。
// このURLは、サインインの処理（Linking を直接受け取る）が使うもので、画面ではないので、expo-router には画面として渡さない。
// 判定と、起動時・起動中の返し方（起動時に `null` を返してはいけない理由）は、`redirectSystemPath`（src）。
//
// 招待URL（`https://<置き場>/invite/<token>` と `warikan-seikatsu://invite/<token>`）も、画面ではない。expo-router に渡すと、
// 同じく「画面が見つかりません」へ遷移する。トークンは、`platform/inviteLink.ts` が（Linking から直接）受け取って持ち、ログイン後に
// 参加確認（`app/join.tsx`）へ回す。ここでは、起動時は `'/'`（ルートから始める）、起動中は `null`（遷移しない）を返す。
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (parseInviteLink(path) !== null) return initial ? '/' : null;
  return redirect(path, initial);
}
