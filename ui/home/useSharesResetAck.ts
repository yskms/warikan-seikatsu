// お知らせ「メンバーが増減した」の操作（docs/screens.md 3章）。どちらも、終わったらホームを読み直す。通信の最中は、次の操作を始めない。
// - 「確認した」: 割合は変えず、見直し済みの印だけを消す。
// - 「全費目を均等にする」（新しいメンバーが0%で入ったとき）: 確認ダイアログ（手で直した割合・上限額も戻る上書きなので）を出し、
//   承諾されたら、その月以降の全費目を均等にする。印は、そのとき一緒に消える。
//
// 失敗したとき: 文言を出す（`categoryErrorMessage`）。サーバーが断ったときは、画面の内容が古いので、読み直す
// （`shouldReloadAfter`。読み直さないと、押しても消えないお知らせが残る）。読み直したあとの画面は、理由で違う:
// - 409（競合）: 最新の状態で出し直す。印が残っていれば、お知らせも残り、もう一度押せる。
// - 409（月が締まった・直せる月の外。「全費目を均等にする」だけ）・403（脱退が確定して直せなくなった）: `editable` が false に
//   なり、お知らせが消える。
// - 404（メンバーでなくなった）: 読み直しの `loadGroup` も404で失敗し、ホームが読み込みの失敗の画面になる（お知らせもそこで消える）。
// 通信の失敗では、読み直さない。同じ操作を送り直しても、二重にはならない（印が無いだけ・均等のまま）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { categoryService } from '../../platform/categoryService.ts';
import { categoryErrorMessage, shouldReloadAfter, type CategoryAction } from '../../src/services/categoryMessage.ts';
import { formatMonthShort } from '../../src/services/dateFormat.ts';
import { equalizeConfirmText } from '../../src/services/homeView.ts';
import { useMounted } from '../useMounted.ts';

interface UseSharesResetAckOptions {
  groupId: string;
  /** ホームの読み直し（操作のあと。成功でも、サーバーに断られたときも呼ぶ） */
  reload(): Promise<void>;
  /** 見ている月。変わったら、前の月の失敗の文言を消す */
  month: string | null;
}

export function useSharesResetAck({ groupId, reload, month }: UseSharesResetAckOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  // 外れたあと（セッション切れ・招待URLによる参加確認への切り替え）に、書き込みを始めない（`ui/useMounted.ts`）。
  // 「全費目を均等にする」は、開いたままの確認ダイアログからも始まる（手で直した割合を上書きするので、見えない画面の割合を直さない）
  const mounted = useMounted();

  useEffect(() => {
    setError(null);
  }, [month]);

  const run = useCallback(
    async (action: CategoryAction, call: () => Promise<void>) => {
      if (running.current || !mounted.current) return;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        await call();
        await reload();
      } catch (e) {
        setError(categoryErrorMessage(e, action));
        if (shouldReloadAfter(e, action)) await reload();
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [reload, mounted],
  );

  const acknowledge = useCallback(
    (targetMonth: string, through: number) =>
      run('acknowledge-reset', () => categoryService.acknowledgeSharesReset(groupId, targetMonth, through)),
    [groupId, run],
  );

  const equalize = useCallback(
    (targetMonth: string) => {
      if (running.current) return;
      const text = equalizeConfirmText(formatMonthShort(targetMonth));
      Alert.alert(text.title, text.message, [
        { text: 'キャンセル', style: 'cancel' },
        { text: text.confirmLabel, onPress: () => void run('reset-equal', () => categoryService.resetSharesToEqual(groupId, targetMonth)) },
      ]);
    },
    [groupId, run],
  );

  return { busy, error, acknowledge, equalize };
}
