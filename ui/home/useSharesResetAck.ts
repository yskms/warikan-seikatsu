// お知らせ「メンバーが増減した」の「確認した」（docs/screens.md 3章）。割合は変えず、見直し済みの印だけを消して、ホームを読み直す。
// 通信の最中は、次の操作を始めない。
//
// 失敗したとき: 文言を出す（`categoryErrorMessage`）。サーバーに断られて、画面の内容が古い（競合・メンバーの増減）ときは、
// 読み直す（`shouldReloadAfter`）。通信の失敗では、読み直さない。同じ確認を送り直しても、二重にはならない
// （印が無いだけ）。
import { useCallback, useEffect, useRef, useState } from 'react';

import { categoryService } from '../../platform/categoryService.ts';
import { categoryErrorMessage, shouldReloadAfter } from '../../src/services/categoryMessage.ts';
import { useMounted } from '../useMounted.ts';

interface UseSharesResetAckOptions {
  groupId: string;
  /** ホームの読み直し（確認のあと。成功でも、サーバーに断られたときも呼ぶ） */
  reload(): Promise<void>;
  /** 見ている月。変わったら、前の月の失敗の文言を消す */
  month: string | null;
}

export function useSharesResetAck({ groupId, reload, month }: UseSharesResetAckOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  // 外れたあと（セッション切れ・招待URLによる参加確認への切り替え）に、書き込みを始めない（`ui/useMounted.ts`）
  const mounted = useMounted();

  useEffect(() => {
    setError(null);
  }, [month]);

  const acknowledge = useCallback(
    async (through: number) => {
      if (running.current || !mounted.current) return;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        await categoryService.acknowledgeSharesReset(groupId, through);
        await reload();
      } catch (e) {
        setError(categoryErrorMessage(e, 'acknowledge-reset'));
        if (shouldReloadAfter(e, 'acknowledge-reset')) await reload();
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [groupId, reload, mounted],
  );

  return { busy, error, acknowledge };
}
