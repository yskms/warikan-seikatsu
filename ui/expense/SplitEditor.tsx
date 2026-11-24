// 「この支出だけ負担を変える」の入力（docs/screens.md 4章）。方法は、割合・均等・金額指定・1人が全額。
// **負担額の計算も、プレビューも出さない**（CLAUDE.md。負担・精算の計算はWorkerだけが持つ。割合・均等の端数の配り方を、
// アプリに書き写さない）。入力の形の検査の結果（合計が100%でない、など）は、`message` で受けて出す。
// 金額指定のメンバーごとの欄は、金額の欄と同じキーパッドで入れる（`keypadTarget`）。割合は、OSの数字キーボード。
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { GroupMember } from '../../src/domain/group.ts';
import type { CustomSplitMethod, SplitDraft } from '../../src/services/expenseForm.ts';
import { initialOf } from '../../src/services/homeView.ts';
import { Avatar } from '../home/Avatar.tsx';
import { useColors } from '../useColors.ts';
import { AmountField } from './AmountField.tsx';
import { Chips, type ChipOption } from './Chips.tsx';

/** キーパッドが入力する先。`null` は、キーパッドを隠す（OSのキーボードで入力する欄を触っているとき）。 */
export type KeypadTarget = { kind: 'amount' } | { kind: 'member'; memberId: string } | null;

const METHODS: { key: CustomSplitMethod; label: string }[] = [
  { key: 'ratio', label: '割合で分ける' },
  { key: 'equal', label: '均等に分ける' },
  { key: 'fixed', label: '金額を指定する' },
  { key: 'single', label: '1人が全額負担' },
];

interface SplitEditorProps {
  split: SplitDraft;
  /** 負担の対象の選択肢（その月に選べるメンバーと、編集で開いた支出に入っているメンバー） */
  members: GroupMember[];
  currencyCode: string;
  minorUnit: number;
  keypadTarget: KeypadTarget;
  /** 入力の形の検査で、直す点（無ければ `null`） */
  message: string | null;
  disabled: boolean;
  onChange(split: SplitDraft): void;
  onKeypadTarget(target: KeypadTarget): void;
}

export function SplitEditor({
  split,
  members,
  currencyCode,
  minorUnit,
  keypadTarget,
  message,
  disabled,
  onChange,
  onKeypadTarget,
}: SplitEditorProps) {
  const colors = useColors();
  const memberOption = (member: GroupMember): ChipOption => ({
    key: member.id,
    label: member.displayName,
    leading: <Avatar initial={initialOf(member.displayName)} color={member.color} size={24} />,
  });

  return (
    <View style={styles.editor}>
      <Chips
        wrap
        options={METHODS}
        selected={split.method}
        disabled={disabled}
        onSelect={(key) => {
          const method = key as CustomSplitMethod;
          onChange({ ...split, method });
          // 金額指定は、金額の欄と同じキーパッドで入れる。ほかの方法では、キーパッドは上の金額の欄のもの
          onKeypadTarget(method === 'fixed' ? { kind: 'member', memberId: members[0]?.id ?? '' } : { kind: 'amount' });
        }}
      />

      {split.method === 'equal' ? (
        <Chips
          wrap
          multiple
          options={members.map(memberOption)}
          selected={split.equalIds}
          disabled={disabled}
          onSelect={(id) =>
            onChange({
              ...split,
              equalIds: split.equalIds.includes(id) ? split.equalIds.filter((x) => x !== id) : [...split.equalIds, id],
            })
          }
        />
      ) : null}

      {split.method === 'single' ? (
        <Chips
          wrap
          options={members.map(memberOption)}
          selected={split.singleId}
          disabled={disabled}
          onSelect={(id) => onChange({ ...split, singleId: id })}
        />
      ) : null}

      {split.method === 'ratio'
        ? members.map((member) => (
            <View key={member.id} style={styles.row}>
              <Avatar initial={initialOf(member.displayName)} color={member.color} size={32} />
              <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
                {member.displayName}
              </Text>
              <TextInput
                accessibilityLabel={`${member.displayName}の割合（パーセント）`}
                value={split.percents[member.id] ?? ''}
                onChangeText={(text) =>
                  // 数字と小数点だけ（形の検査は、保存の前に `parsePercent`）
                  onChange({ ...split, percents: { ...split.percents, [member.id]: text.replace(/[^0-9.]/g, '') } })
                }
                onFocus={() => onKeypadTarget(null)}
                editable={!disabled}
                keyboardType="decimal-pad"
                maxLength={6}
                selectTextOnFocus
                style={[styles.percent, { color: colors.textPrimary, backgroundColor: colors.surface, borderColor: colors.border }]}
              />
              <Text style={[styles.unit, { color: colors.textSecondary }]}>%</Text>
            </View>
          ))
        : null}

      {split.method === 'fixed'
        ? members.map((member) => (
            <View key={member.id} style={styles.row}>
              <Avatar initial={initialOf(member.displayName)} color={member.color} size={32} />
              <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
                {member.displayName}
              </Text>
              <AmountField
                compact
                label={`${member.displayName}の負担額`}
                expression={split.amounts[member.id] ?? ''}
                currencyCode={currencyCode}
                minorUnit={minorUnit}
                active={keypadTarget?.kind === 'member' && keypadTarget.memberId === member.id}
                onPress={disabled ? undefined : () => onKeypadTarget({ kind: 'member', memberId: member.id })}
              />
            </View>
          ))
        : null}

      {message !== null ? (
        <Text style={[styles.message, { color: colors.error }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  percent: {
    width: 96,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 18,
    textAlign: 'right',
  },
  unit: { fontSize: 16, width: 20 },
  message: { fontSize: 13, lineHeight: 18 },
});
