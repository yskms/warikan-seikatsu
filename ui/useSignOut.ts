// ログアウトの操作（確認 → `accountService.signOut`）。成功すると、`platform/accountService.ts` の包みが、セッションが
// 無くなったことを通知し、`AuthStateProvider` がログイン画面へ戻す（ここから状態は変えない。CLAUDE.md）。
// 端末の値を消せなかったとき（`storage-failed`）だけ、失敗として文言を出す。サーバー側の失効まで確認できなかった
// （`serverRevoked: false`）ことは、利用者に伝えない（端末の値は消してあり、サーバーに残ったセッションは、使われないまま
// 90日で切れる。`SignOutResult`）。設定の画面を作るとき、そこへ移す。
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { accountService } from '../platform/accountService.ts';
import { signOutErrorMessage } from '../src/services/signOutMessage.ts';

export function useSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await accountService.signOut();
    } catch (e) {
      setError(signOutErrorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  /** 確認のダイアログを出して、了承されたらログアウトする。 */
  const confirmSignOut = useCallback(() => {
    if (running.current) return;
    Alert.alert('ログアウトしますか？', 'もう一度ログインすれば、同じグループを開けます。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'ログアウト', style: 'destructive', onPress: () => void run() },
    ]);
  }, [run]);

  return { confirmSignOut, busy, error };
}
