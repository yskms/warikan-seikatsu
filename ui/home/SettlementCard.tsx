// 精算のカード（docs/screens.md 3章）。送金は、誰から誰へいくらかを、矢印と名前で出す。
//
// すべて処理済みのときは、カードを小さくする（余白と文字を小さくし、送金は薄い色にする。screens.md 3章）。
//
// **いまは読み取り専用**: 「この月を締める」ボタンと、未処理の送金の「精算完了」「繰越」ボタン（5章）は、まだ作っていない
// （締めの確認のシートと、書き込みのAPIの呼び出しを作るときに足す。`SettlementModel` の `blockedText`（締められない理由）と、
// 送金の `pending` は、そのためにすでに組み立ててある）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { SettlementModel, TransferLine } from '../../src/services/homeView.ts';
import { useColors } from '../useColors.ts';

export function SettlementCard({ model }: { model: SettlementModel }) {
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
            <Transfer key={line.key} line={line} muted={done} />
          ))}
        </View>
      ) : null}

      {model.kind === 'estimate' && model.carryNote ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.carryNote}</Text>
      ) : null}
      {model.kind === 'estimate' && model.blockedText ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>{model.blockedText}</Text>
      ) : null}
    </View>
  );
}

function Transfer({ line, muted }: { line: TransferLine; muted: boolean }) {
  const colors = useColors();
  const color = muted ? colors.textSecondary : colors.textPrimary;
  return (
    <View
      accessible
      accessibilityLabel={`${line.fromName}から${line.toName}へ ${line.amountText}${line.statusText ? `、${line.statusText}` : ''}`}
      style={styles.transfer}
    >
      <View style={styles.names}>
        <Text style={[styles.name, muted && styles.nameDone, { color }]} numberOfLines={1}>
          {line.fromName}
        </Text>
        <MaterialCommunityIcons name="arrow-right" size={muted ? 16 : 18} color={colors.textSecondary} />
        <Text style={[styles.name, muted && styles.nameDone, { color }]} numberOfLines={1}>
          {line.toName}
        </Text>
      </View>
      <View style={styles.amountColumn}>
        <Text style={[styles.amount, muted && styles.amountDone, { color }]}>{line.amountText}</Text>
        {line.statusText ? <Text style={[styles.status, { color: colors.textSecondary }]}>{line.statusText}</Text> : null}
      </View>
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
  lines: { gap: 12 },
  linesDone: { gap: 6 },
  transfer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  names: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, flexShrink: 1 },
  nameDone: { fontSize: 14 },
  amountColumn: { alignItems: 'flex-end' },
  amount: { fontSize: 20, fontWeight: '700' },
  amountDone: { fontSize: 15 },
  status: { fontSize: 12 },
});
