// 月締め・精算完了・繰越（docs/screens.md 5章）と、締めの確認のシートを開くときの読み込み。認証が要る呼び出しは、必ず
// `SessionAccess.withSession` を通す（端末のセッションが無くなったことを画面へ伝えるのは、その包みだけ。CLAUDE.md）。
// `access` は、`platform/accountService.ts` の `sessionAccess`（通知で包んだもの）を渡す。
//
// 締めの確認は、**ホームが読んだ古い集計ではなく、シートを開くときに読み直した集計**で出す（確認した送金の額と、締めた結果が
// ずれにくくする。サーバーは、確認した内容を指定して締めることはできない。他のメンバーがそのあいだに支出を変えると、
// 締めた結果は、確認の内容と違いうる。そのときも、締めたあとにホームが取り直した結果が正）。
import type { GroupDetail } from '../domain/group.ts';
import type { MonthList, MonthView } from '../domain/month.ts';
import type { GroupRepository } from '../repositories/groupRepository.ts';
import type { MonthRepository } from '../repositories/monthRepository.ts';
import type { CloseResult, SettlementRepository } from '../repositories/settlementRepository.ts';
import type { SessionAccess } from './accountService.ts';

export interface SettlementServiceDeps {
  groups: GroupRepository;
  months: MonthRepository;
  settlements: SettlementRepository;
  access: SessionAccess;
}

/** 締めの確認のシートを開くのに要るデータ。 */
export interface CloseFormData {
  /** メンバーの名前・通貨・脱退を選んでいるメンバー */
  group: GroupDetail;
  /** 今月（`currentMonth`）。「月の途中」かの判断に使う */
  months: MonthList;
  /** その月の集計（締める前は見込み。他のメンバーが先に締めていれば、締めた結果） */
  summary: MonthView;
}

export function createSettlementService({ groups, months, settlements, access }: SettlementServiceDeps) {
  return {
    /** 締めの確認のシートを開くときの読み込み。毎回読み直す（上のコメント）。 */
    loadClose(groupId: string, month: string): Promise<CloseFormData> {
      return access.withSession(async (session) => {
        const [group, monthList, summary] = await Promise.all([
          groups.get(session, groupId),
          months.list(session, groupId),
          months.summary(session, groupId, month),
        ]);
        return { group, months: monthList, summary };
      });
    },

    /** 月を締める。やり直さない（競合したら、画面が読み直して案内する）。 */
    close(groupId: string, month: string): Promise<CloseResult> {
      return access.withSession((session) => settlements.close(session, groupId, month));
    },

    /** 送金を精算済みにする（確定後は戻せない）。 */
    settle(transferId: string): Promise<{ id: string }> {
      return access.withSession((session) => settlements.settle(session, transferId));
    },

    /** 送金を次の月に繰り越す（確定後は戻せない）。 */
    carry(transferId: string): Promise<{ id: string }> {
      return access.withSession((session) => settlements.carry(session, transferId));
    },
  };
}

export type SettlementService = ReturnType<typeof createSettlementService>;
