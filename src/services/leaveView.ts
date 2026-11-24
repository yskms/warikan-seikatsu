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
      confirm: LeaveConfirm;
      /**
       * 確認に、グループが消える警告（`leaveDeletesGroup`。サーバーの値）を出すか。出したときだけ、送るときに、確認の申告
       * （`acknowledgeDelete`）を付ける。警告を出さなかったのに消えることになったとき（画面を読んだあとで、残る人が脱退済みに
       * なった、など）は、サーバーが断る（`worker/src/deleteAck.ts`）。
       */
      deletesGroup: boolean;
    }
  /** 脱退を選んでいて、まだ確定していない。「脱退を取り消す」を出す */
  | { kind: 'cancel'; buttonLabel: string; note: string };

export const LEAVE_BUTTON_LABEL = 'このグループから脱退する';
export const LEAVE_AND_DELETE_BUTTON_LABEL = 'グループを削除して脱退';
export const CANCEL_LEAVE_BUTTON_LABEL = '脱退を取り消す';

const LAST_MEMBER_WARNING =
  'あなたが、このグループの最後のメンバーです。脱退が確定すると、このグループのデータはすべて削除され、元に戻せません。';

/**
 * 脱退の欄の出し分け。出すのは、**参加中（`active`）で、脱退が確定したものとして扱われていない**（`leaveEffective` が false）
 * 自分だけ。`leaveEffective` は、`status` が `leaving` 以降の人と、`active` のまま脱退月が終わった人（Cronの確定の前）を含む
 * サーバーの値で、月の判定を書き写さない。**自分の状態が `unknown`（知らない値）のときは、出さない**（脱退を選べるかを、知らない
 * 状態から決めない。`GroupMember.status` の注意書きへの、この画面での答え）。
 *
 * 脱退を選んだあとに、グループが消えるか（`leaveDeletesGroup`）も、サーバーの値。**固定費の支払う人の注意**（設計にある、
 * 「家賃の固定費は、支払う人を選び直す必要があります」）は、固定費の画面を作っていないので、出していない。
 */
export function buildLeaveSection(
  group: Pick<GroupDetail, 'memberId' | 'members' | 'leaveDeletesGroup'>,
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
    };
  }

  if (lastMember) {
    return {
      kind: 'request',
      deletesGroup: true,
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
  return {
    kind: 'request',
    deletesGroup: false,
    buttonLabel: LEAVE_BUTTON_LABEL,
    note: '脱退を選ぶと、今月を締めたとき、または来月1日に、脱退が確定します。確定するまでは、取り消せます。',
    confirm: {
      title: 'このグループから脱退しますか？',
      message:
        '今月で脱退します。今月を締めるか、来月1日に確定します。確定するまでは、取り消せます。\n\n' +
        '今月をすでに締めている場合は、すぐに確定します。',
      confirmLabel: '脱退する',
    },
  };
}
