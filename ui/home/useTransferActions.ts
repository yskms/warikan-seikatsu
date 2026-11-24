// 送金の「精算完了」「繰越」（docs/screens.md 5章）。確認ダイアログ（取り消せないことの確認）を出し、承諾されたら実行して、
// ホームを読み直す。通信の最中は、次の操作を始めない（1つずつ処理する）。
//
// 失敗したとき: 文言を出す（`settlementErrorMessage`）。サーバーが断ったとき（他のメンバーが先に処理した、など）は、
// 画面の内容が古いので、読み直す（`shouldReloadAfter`）。通信の失敗では、読み直さない（同じ失敗になりうる）。
// どちらも、同じ送金をやり直しても二重にならない（済んでいれば 409 `transfer_not_pending`）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { settlementService } from '../../platform/settlementService.ts';
import { carryConfirmText, settleConfirmText, type TransferLine } from '../../src/services/homeView.ts';
import { settlementErrorMessage, shouldReloadAfter } from '../../src/services/settlementMessage.ts';
import type { TransferBusy } from './SettlementCard.tsx';

interface UseTransferActionsOptions {
  /** ホームの読み直し（操作のあと。成功でも、サーバーに断られたときも呼ぶ） */
  reload(): Promise<void>;
  /** 見ている月。変わったら、前の月の失敗の文言を消す */
  month: string | null;
  /** 繰越先の月の名前（「12月」。繰越の確認に出す） */
  carryMonthLabel: string;
}

export function useTransferActions({ reload, month, carryMonthLabel }: UseTransferActionsOptions) {
  const [busy, setBusy] = useState<TransferBusy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    setError(null);
  }, [month]);

  const run = useCallback(
    async (transferId: string, action: 'settle' | 'carry') => {
      if (running.current) return;
      running.current = true;
      setBusy({ transferId, action });
      setError(null);
      try {
        if (action === 'settle') await settlementService.settle(transferId);
        else await settlementService.carry(transferId);
        await reload();
      } catch (e) {
        setError(settlementErrorMessage(e, action));
        if (shouldReloadAfter(e)) await reload();
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [reload],
  );

  const settle = useCallback(
    (line: TransferLine) => {
      if (running.current || line.transferId === null) return;
      const transferId = line.transferId;
      const text = settleConfirmText(line);
      Alert.alert(text.title, text.message, [
        { text: 'キャンセル', style: 'cancel' },
        { text: text.confirmLabel, onPress: () => void run(transferId, 'settle') },
      ]);
    },
    [run],
  );

  const carry = useCallback(
    (line: TransferLine) => {
      if (running.current || line.transferId === null) return;
      const transferId = line.transferId;
      const text = carryConfirmText(line, carryMonthLabel);
      Alert.alert(text.title, text.message, [
        { text: 'キャンセル', style: 'cancel' },
        { text: text.confirmLabel, onPress: () => void run(transferId, 'carry') },
      ]);
    },
    [run, carryMonthLabel],
  );

  return { busy, error, settle, carry };
}
