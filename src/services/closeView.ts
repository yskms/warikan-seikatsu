// 締めの確認のシート（docs/screens.md 5章の「締めの確認」）に出す内容を、サーバーの応答から組み立てる。画面
// （`ui/close/CloseSheet.tsx`）は、ここの結果を並べるだけ。**精算の計算も、締められるかの判断もしない**: 送金は集計の
// 応答の見込み、締められるかは `close.closable`（サーバーの答え）に従う（`homeView.ts` の `buildSettlement`）。
// ここでやるのは、表示の文言と、「月の途中」「脱退が確定する」の注意書きの出し分けだけ。
import type { GroupDetail } from '../domain/group.ts';
import type { MonthList, MonthView } from '../domain/month.ts';
import { formatMonthShort, nextMonth } from './dateFormat.ts';
import { buildSettlement, memberLookup, moneyFormatters, type TransferLine } from './homeView.ts';

export interface CloseConfirmInput {
  group: GroupDetail;
  months: MonthList;
  summary: MonthView;
}

export interface CloseConfirmModel {
  title: string;
  /**
   * - `ready`: 締められる（「締める」を押せる）
   * - `blocked`: いまは締められない（`statusText` に理由。「締める」は押せない）
   * - `closed`: 開いているあいだに、ほかのメンバーが先に締めた（`statusText` に案内。「締める」は出さない）
   */
  state: 'ready' | 'blocked' | 'closed';
  /** `blocked`・`closed` の理由 */
  statusText: string | null;
  /** 確定する送金（締める前の見込み。締めた月は空） */
  lines: TransferLine[];
  /** 送金が無いとき */
  emptyText: string | null;
  /** 先月からの繰越を含むときだけ */
  carryNote: string | null;
  /** 常に出す注意（締めた後の制限） */
  notice: string;
  /** 月の途中で締めるときの注意（目立たせる）。月の途中でなければ `null` */
  midMonthNote: string | null;
  /** この月を脱退月に選んでいるメンバーがいるときの注意（1人につき1行） */
  leaveNotes: string[];
}

export const CLOSE_NOTICE = '締めた後は、この月の支出を追加・変更・削除できません。';
export const ALREADY_CLOSED_TEXT = 'この月は、すでに締められています。ホームで、結果を確認してください。';

export function buildCloseConfirm({ group, months, summary }: CloseConfirmInput): CloseConfirmModel {
  const title = `${formatMonthShort(summary.month)}を締める`;
  const lookup = memberLookup(group, summary);
  const { money } = moneyFormatters(group);
  const settlement = buildSettlement(summary, lookup, money);

  if (settlement.kind === 'closed') {
    return {
      title,
      state: 'closed',
      statusText: ALREADY_CLOSED_TEXT,
      lines: [],
      emptyText: null,
      carryNote: null,
      notice: CLOSE_NOTICE,
      midMonthNote: null,
      leaveNotes: [],
    };
  }

  // 「月の途中」は、サーバーが返す今月と同じ月を締めるとき。締めたあとの残りの支出は、次の月に登録する（9章の「登録できる月」）
  const following = nextMonth(summary.month);
  const midMonth = months.currentMonth === summary.month;
  // 脱退を選んでいるメンバーの脱退は、その月を締めると確定する（`dueLeaves`。5章の2）。表示だけで、確定はサーバー
  const leaving = group.members.filter(
    (member) => member.status === 'active' && member.leaveRequestedMonth !== null && member.leaveRequestedMonth <= summary.month,
  );

  return {
    title,
    state: settlement.closable ? 'ready' : 'blocked',
    statusText: settlement.blockedText,
    lines: settlement.lines,
    emptyText: settlement.emptyText,
    carryNote: settlement.carryNote,
    notice: CLOSE_NOTICE,
    midMonthNote: midMonth
      ? `まだ月の途中です。この月の残りの支出は、${following === null ? '次の月' : formatMonthShort(following)}分として登録します。`
      : null,
    // 自分が脱退を選んでいるときは、「あなた」と言う（自分の名前に「さん」を付けない）
    leaveNotes: leaving.map((member) => `${member.isMe ? 'あなた' : `${member.displayName}さん`}の脱退は、この月を締めると確定します。`),
  };
}
