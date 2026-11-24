// 送金の1行（誰から誰へ、いくら）。精算のカード（`SettlementCard.tsx`）と、締めの確認のシート（`ui/close/CloseSheet.tsx`）で使う。
// `muted` は、処理済みの送金を、小さく薄く出す（screens.md 3章）。
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { TransferLine } from '../../src/services/homeView.ts';
import { useColors } from '../useColors.ts';

export function TransferRow({ line, muted = false }: { line: TransferLine; muted?: boolean }) {
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
  transfer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  names: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, flexShrink: 1 },
  nameDone: { fontSize: 14 },
  amountColumn: { alignItems: 'flex-end' },
  amount: { fontSize: 20, fontWeight: '700' },
  amountDone: { fontSize: 15 },
  status: { fontSize: 12 },
});
