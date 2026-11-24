// 脱退を選ぶ・取り消す操作（メンバーと招待の画面の下。docs/screens.md 6章）に出す内容の組み立て。サーバーの値を、文字と出し分けに
// するだけで、**最後の1人かの判断も、脱退が確定したかの判断もしない**（`GroupDetail.leaveDeletesGroup` と、メンバーの
// `leaveEffective` は、サーバーの値。CLAUDE.md）。画面（`ui/settings/MembersScreen.tsx`）は、ここの結果を並べるだけ。
import type { GroupDetail } from '../domain/group.ts';

/** 確認ダイアログ（`Alert`）の内容 */
export interface LeaveConfirm {
  title: string;
  message: string;
  /** 実行するボタンの文言（取り消せない操作なので、ダイアログでは破壊的な見た目にする） */
  confirmLabel: string;
}

export type LeaveSection =
  /** 出さない（脱退が確定している・参加中でない・知らない状態・自分が見つからない） */
  | { kind: 'hidden' }
  /** まだ脱退を選んでいない。「脱退する」を出す */
  | {
      kind: 'request';
      buttonLabel: string;
      note: string;
      /** 自分が支払う人の固定費があるときの、欄の添え書き（無ければ `null`）。確認の本文には、重複を省いた同じ内容が入る */
      payerNote: string | null;
      confirm: LeaveConfirm;
      /**
       * 確認に、グループが消える警告（`leaveDeletesGroup`。サーバーの値）を出すか。出したときだけ、送るときに、確認の申告
       * （`acknowledgeDelete`）を付ける。警告を出さなかったのに消えることになったとき（画面を読んだあとで、残る人が脱退済みに
       * なった、など）は、サーバーが断る（`worker/src/deleteAck.ts`）。
       */
      deletesGroup: boolean;
    }
  /** 脱退を選んでいて、まだ確定していない。「脱退を取り消す」を出す */
  | { kind: 'cancel'; buttonLabel: string; note: string; payerNote: string | null };

export const LEAVE_BUTTON_LABEL = 'このグループから脱退する';
export const LEAVE_AND_DELETE_BUTTON_LABEL = 'グループを削除して脱退';
export const CANCEL_LEAVE_BUTTON_LABEL = '脱退を取り消す';

/** 添え書きに並べる固定費の名前の数（それ以上は「ほかN件」） */
const PAYER_NOTE_NAMES = 2;

/**
 * 自分が支払う人の固定費があるときの添え書き（docs/screens.md 6章）。サーバーは、脱退が確定すると、支払う人が脱退した固定費を止める
 * （付け替えていなければ。docs/backend-design.md 5章の「脱退」）。確定したあとは、本人は固定費を変えられない（403）ので、「確定する前に」と
 * 案内する。**脱退を選ぶ前の欄**（`request`）は、今月をすでに締めていると、脱退を選んだ時点で確定するので、「脱退する前に」も添える。
 * 脱退を選んだあとの欄（`cancel`）は、確定していないので、添えない。**確認ダイアログ**（`confirm`）の本文は、直前に「今月をすでに
 * 締めている場合は、すぐに確定します。」があるので、同じ説明を繰り返さない（ダイアログが長くなる。文字を大きくした端末で読みにくい）。
 * 題は、同じものを1つにまとめる（内容が無い同じカテゴリの固定費が2件あっても、「家賃、家賃」と並べない）。名前が無ければ `null`。
 */
export function payerRecurringNote(titles: readonly string[], kind: 'request' | 'cancel' | 'confirm'): string | null {
  const unique = [...new Set(titles)];
  if (unique.length === 0) return null;
  const shown = unique.slice(0, PAYER_NOTE_NAMES);
  const rest = unique.length - shown.length;
  const names = rest > 0 ? `${shown.join('、')}ほか${rest}件` : shown.join('、');
  return (
    `${names}の固定費は、支払う人を選び直す必要があります。脱退が確定すると、選び直していない固定費は自動登録が止まります。` +
    '確定する前に、設定の「固定費」から選び直してください。' +
    (kind === 'request' ? '今月をすでに締めている場合は、脱退を選ぶとすぐ確定するので、脱退する前に選び直してください。' : '')
  );
}

const LAST_MEMBER_WARNING =
  'あなたが、このグループの最後のメンバーです。脱退が確定すると、このグループのデータはすべて削除され、元に戻せません。';

/**
 * 脱退の欄の出し分け。出すのは、**参加中（`active`）で、脱退が確定したものとして扱われていない**（`leaveEffective` が false）
 * 自分だけ。`leaveEffective` は、`status` が `leaving` 以降の人と、`active` のまま脱退月が終わった人（Cronの確定の前）を含む
 * サーバーの値で、月の判定を書き写さない。**自分の状態が `unknown`（知らない値）のときは、出さない**（脱退を選べるかを、知らない
 * 状態から決めない。`GroupMember.status` の注意書きへの、この画面での答え）。
 *
 * 脱退を選んだあとに、グループが消えるか（`leaveDeletesGroup`）も、サーバーの値。
 *
 * **固定費の支払う人の添え書き**（「家賃の固定費は、支払う人を選び直す必要があります」）は、`payerRecurringTitles`（自分が支払う人の、
 * 止まっていない・終了していない固定費の題。`myPayerRecurringTitles`）があるときだけ出す。固定費が読めなかったとき（呼ぶ側が
 * 空で渡す）は、出ないだけ。**グループが消える（`leaveDeletesGroup`）ときは出さない**（固定費も一緒に消える）。
 */
export function buildLeaveSection(
  group: Pick<GroupDetail, 'memberId' | 'members' | 'leaveDeletesGroup'>,
  payerRecurringTitles: readonly string[] = [],
): LeaveSection {
  const me = group.members.find((member) => member.id === group.memberId);
  if (me === undefined || me.status !== 'active' || me.leaveEffective) return { kind: 'hidden' };
  const lastMember = group.leaveDeletesGroup;

  if (me.leaveRequestedMonth !== null) {
    return {
      kind: 'cancel',
      buttonLabel: CANCEL_LEAVE_BUTTON_LABEL,
      note: lastMember
        ? `${LAST_MEMBER_WARNING}取り消すと、このグループに残ります。`
        : '取り消すと、このグループに残ります。',
      payerNote: lastMember ? null : payerRecurringNote(payerRecurringTitles, 'cancel'),
    };
  }

  if (lastMember) {
    return {
      kind: 'request',
      deletesGroup: true,
      payerNote: null,
      buttonLabel: LEAVE_AND_DELETE_BUTTON_LABEL,
      note: `${LAST_MEMBER_WARNING}確定は、今月を締めたとき、または来月1日です。`,
      confirm: {
        title: 'グループを削除して脱退しますか？',
        message:
          `${LAST_MEMBER_WARNING}\n\n` +
          '確定は、今月を締めたとき、または来月1日です。今月をすでに締めている場合は、すぐに削除されます。' +
          '確定するまでは、脱退を取り消せます。',
        confirmLabel: 'グループを削除して脱退',
      },
    };
  }
  const payerNote = payerRecurringNote(payerRecurringTitles, 'request');
  const confirmPayerNote = payerRecurringNote(payerRecurringTitles, 'confirm');
  return {
    kind: 'request',
    deletesGroup: false,
    payerNote,
    buttonLabel: LEAVE_BUTTON_LABEL,
    note: '脱退を選ぶと、今月を締めたとき、または来月1日に、脱退が確定します。確定するまでは、取り消せます。',
    confirm: {
      title: 'このグループから脱退しますか？',
      message:
        '今月で脱退します。今月を締めるか、来月1日に確定します。確定するまでは、取り消せます。\n\n' +
        '今月をすでに締めている場合は、すぐに確定します。' +
        (confirmPayerNote === null ? '' : `\n\n${confirmPayerNote}`),
      confirmLabel: '脱退する',
    },
  };
}
