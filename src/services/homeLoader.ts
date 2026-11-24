// ホームの読み込みの状態と、その切り替え（docs/screens.md 3章）。画面（`ui/home/HomeScreen.tsx`）から切り出した、Reactに
// 依存しない部分。「新しく始めた読み込みが古いものを追い越し、古い応答を捨てる」規則と、取り直しの失敗の扱いは、画面を触るたびに
// 壊れやすいので、`npm test` で守る（`homeLoader.test.ts`）。
//
// 規則:
// - 読み込みは、`reload`（グループ・月の一覧・費目と、選んでいた月）と `selectMonth`（選んだ月だけ）の2つ。どちらも、始めるたびに
//   番号（`requestId`）を進め、**最後に始めたものの応答だけ**を反映する。月を素早く切り替えたとき、前の月の結果が、いまの月の
//   画面に出ない。引っ張って更新（`reload(true)`）の途中で月を切り替えても、`refreshing` が true のまま残らない。
// - 失敗は、表示中のデータを消さずに `error` へ文言を入れる（読み込めた分を消さない）。次に成功した読み込みが、`error` を消す。
// - 選んだ月のデータが届いているかは、`currentMonthData` で見る（月を切り替えた直後や、切り替えに失敗したあとは、前の月の
//   データを出さない）。
import type { HomeGroupData, HomeMonthData, HomeService } from './homeService.ts';

export interface HomeLoadState {
  /** グループ（メンバー）・月の一覧・費目。まだ読めていなければ `null` */
  group: HomeGroupData | null;
  /** いま選んでいる月（`YYYY-MM`）。まだ決まっていなければ `null` */
  selected: string | null;
  /** 最後に読めた月のデータ。`selected` と同じ月とは限らない（`currentMonthData` で確かめる） */
  monthData: HomeMonthData | null;
  /** 最後の読み込みの失敗の文言 */
  error: string | null;
  /** 引っ張って更新の最中か */
  refreshing: boolean;
}

export const INITIAL_HOME_STATE: HomeLoadState = {
  group: null,
  selected: null,
  monthData: null,
  error: null,
  refreshing: false,
};

/** 選んだ月のデータ。まだ届いていない（切り替えの途中、失敗したあと）ときは `null`。 */
export function currentMonthData(state: HomeLoadState): HomeMonthData | null {
  const { group, monthData, selected } = state;
  if (group === null || monthData === null || selected === null) return null;
  // 集計と支出の両方が、選んだ月のものであること（Repositoryも、要求した月と違う結果は失敗にしている）
  return monthData.summary.month === selected && monthData.expenses.month === selected ? monthData : null;
}

export interface HomeLoaderDeps {
  service: Pick<HomeService, 'loadGroup' | 'loadMonth'>;
  groupId: string;
  /** 読み込みの失敗を、画面に出す文言にする（`homeMessage.ts`） */
  errorMessage(error: unknown): string;
}

export function createHomeLoader({ service, groupId, errorMessage }: HomeLoaderDeps) {
  let state = INITIAL_HOME_STATE;
  const listeners = new Set<() => void>();
  // 最後に始めた読み込みの番号
  let requestId = 0;

  function update(patch: Partial<HomeLoadState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  return {
    /** 変わらないあいだは、同じオブジェクトを返す（`useSyncExternalStore` の要件）。 */
    getState: (): HomeLoadState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * グループ・月の一覧・費目と、選んでいた月（一覧に無くなっていれば今月）の集計・支出を読み直す。`pulled` は、引っ張って更新。
     * グループを読んでから月を読む（選べる月は、一覧で決まるため）。
     */
    async reload(pulled: boolean): Promise<void> {
      const id = ++requestId;
      if (pulled) update({ refreshing: true });
      try {
        const group = await service.loadGroup(groupId);
        if (id !== requestId) return;
        // 選んでいた月が、一覧から無くなったとき（参加し直した、など）は、今月へ戻す
        const wanted = state.selected;
        const month =
          wanted !== null && group.months.months.some((item) => item.month === wanted)
            ? wanted
            : group.months.currentMonth;
        const monthData = await service.loadMonth(groupId, month);
        if (id !== requestId) return;
        update({ group, selected: month, monthData, error: null });
      } catch (e) {
        if (id === requestId) update({ error: errorMessage(e) });
      } finally {
        if (id === requestId && state.refreshing) update({ refreshing: false });
      }
    },

    /** 月を切り替えて、その月の集計・支出だけを読む（グループ・月の一覧は読み直さない）。 */
    async selectMonth(month: string): Promise<void> {
      const id = ++requestId;
      update({ selected: month, error: null });
      try {
        const monthData = await service.loadMonth(groupId, month);
        if (id !== requestId) return;
        update({ monthData });
      } catch (e) {
        if (id === requestId) update({ error: errorMessage(e) });
      } finally {
        if (id === requestId && state.refreshing) update({ refreshing: false });
      }
    },
  };
}

export type HomeLoader = ReturnType<typeof createHomeLoader>;
