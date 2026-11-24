// 精算のカード（docs/screens.md 3章・5章）。送金は、誰から誰へいくらかを、矢印と名前で出す。
//
// - 締める前（見込み）: 「この月を締める」。押せるかは、サーバーが返す `close.closable`（`SettlementModel` の `closable`）。
//   押せないときは、ボタンを押せなくして、理由（`blockedText`）を添える。押すと、締めの確認のシート（`app/close.tsx`）を開く。
// - 締めた後: 未処理の送金ごとに「精算完了」「繰越」。繰り越せない送金（`canCarry` が false。サーバーが返す）には、「繰越」を
//   出さず、理由を添える。確認（取り消せないことの確認ダイアログ）と、実行は、呼び出し側（`useTransferActions`）。
//   通信の最中（`busy`）は、すべての操作ボタンを押せなくする（1つずつ処理する）。
// - すべて処理済みのときは、カードを小さくする（余白と文字を小さくし、送金は薄い色にする）。
import { StyleSheet, Text, View } from 'react-native';

import { CARRY_BLOCKED_TEXT, type SettlementModel, type TransferLine } from '../../src/services/homeView.ts';
import { PrimaryButton } from '../PrimaryButton.tsx';
import { useColors } from '../useColors.ts';
import { TransferRow } from './TransferRow.tsx';

export interface TransferBusy {
  transferId: string;
  action: 'settle' | 'carry';
}

interface SettlementCardProps {
  model: SettlementModel;
  onClose(): void;
  onSettle(line: TransferLine): void;
  onCarry(line: TransferLine): void;
  /** 精算完了・繰越の通信の最中の送金と操作 */
  busy: TransferBusy | null;
  /** 精算完了・繰越の失敗の文言 */
  actionError: string | null;
}

export function SettlementCard({ model, onClose, onSettle, onCarry, busy, actionError }: SettlementCardProps) {
  const colors = useColors();
  const done = model.kind === 'closed' && model.doneText !== null;
  return (
    <View
      style={[styles.card, done && styles.cardDone, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, done && styles.titleDone, { color: colors.textPrimary }]} accessibilityRole="header">
          {model.title}
        </Text>
        {model.kind === 'closed' && model.pendingText ? (
          <Text style={[styles.pending, { color: colors.textPrimary }]}>{model.pendingText}</Text>
        ) : null}
      </View>

      {model.kind === 'closed' && model.doneText ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.doneText}</Text>
      ) : null}
      {model.kind === 'estimate' && model.emptyText ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.emptyText}</Text>
      ) : null}

      {model.lines.length > 0 ? (
        <View style={[styles.lines, done && styles.linesDone]}>
          {model.lines.map((line) => (
            <View key={line.key} style={styles.lineBlock}>
              <TransferRow line={line} muted={done} />
              {model.kind === 'closed' && line.pending && line.transferId !== null ? (
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <PrimaryButton
                      compact
                      label="精算完了"
                      busy={busy?.transferId === line.transferId && busy.action === 'settle'}
                      disabled={busy !== null}
                      onPress={() => onSettle(line)}
                    />
                  </View>
                  {line.canCarry ? (
                    <View style={styles.action}>
                      <PrimaryButton
                        compact
                        variant="secondary"
                        label="繰越"
                        busy={busy?.transferId === line.transferId && busy.action === 'carry'}
                        disabled={busy !== null}
                        onPress={() => onCarry(line)}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
              {model.kind === 'closed' && line.pending && !line.canCarry ? (
                <Text style={[styles.note, { color: colors.textSecondary }]}>{CARRY_BLOCKED_TEXT}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {model.kind === 'closed' && actionError !== null ? (
        <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      {model.kind === 'estimate' && model.carryNote ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.carryNote}</Text>
      ) : null}
      {model.kind === 'estimate' && model.blockedText ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.blockedText}</Text>
      ) : null}
      {model.kind === 'estimate' ? (
        <PrimaryButton label="この月を締める" disabled={!model.closable} onPress={onClose} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  cardDone: { padding: 12, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  titleDone: { fontSize: 15 },
  pending: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 14, lineHeight: 20 },
  lines: { gap: 16 },
  linesDone: { gap: 6 },
  lineBlock: { gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
