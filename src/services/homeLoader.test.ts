// ホームの読み込みの状態と切り替えのテスト。`npm test` で実行する。応答を手動で返せる偽のServiceで、読み込みが重なったときの
// 順序（古い応答を捨てる）、取り直しの失敗で表示を残すこと、`refreshing` が残らないことを確かめる。
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GroupDetail } from '../domain/group.ts';
import type { ExpenseList, MonthList, MonthView } from '../domain/month.ts';
import { AuthError } from '../repositories/authError.ts';
import {
  createHomeLoader,
  currentMonthData,
  INITIAL_HOME_STATE,
  type HomeLoadState,
} from './homeLoader.ts';
import type { HomeGroupData, HomeMonthData } from './homeService.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // 拒否されたまま、誰も待たない（テストが後で解決・拒否する）ときの警告を避ける
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function groupData(months: string[], currentMonth: string, name = 'ふたりの生活費'): HomeGroupData {
  return {
    group: { id: 'g1', name } as GroupDetail,
    months: { currentMonth, months: months.map((month) => ({ month, status: 'open' as const })) } as MonthList,
    categories: [],
  };
}

function monthData(month: string, totalMinor = 0): HomeMonthData {
  return {
    summary: { month, totalMinor } as MonthView,
    expenses: { month, closed: false, expenses: [] } as ExpenseList,
  };
}

/** 呼び出しごとに、手動で解決できる応答を作る偽のService。 */
function setup() {
  const groupCalls: Deferred<HomeGroupData>[] = [];
  const monthCalls: { month: string; result: Deferred<HomeMonthData> }[] = [];
  const service = {
    loadGroup(): Promise<HomeGroupData> {
      const call = deferred<HomeGroupData>();
      groupCalls.push(call);
      return call.promise;
    },
    loadMonth(_groupId: string, month: string): Promise<HomeMonthData> {
      const result = deferred<HomeMonthData>();
      monthCalls.push({ month, result });
      return result.promise;
    },
  };
  const loader = createHomeLoader({
    service,
    groupId: 'g1',
    errorMessage: (error) => `失敗:${error instanceof AuthError ? error.code : 'other'}`,
  });
  const states: HomeLoadState[] = [];
  loader.subscribe(() => states.push(loader.getState()));
  return { loader, groupCalls, monthCalls, states };
}

/** 待っている非同期の処理を進める。 */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const MONTHS = ['2026-09', '2026-10', '2026-11'];

describe('createHomeLoader', () => {
  it('最初の状態は空で、変化がなければ同じオブジェクトを返す', () => {
    const { loader } = setup();
    assert.equal(loader.getState(), INITIAL_HOME_STATE);
    assert.equal(loader.getState(), loader.getState());
  });

  it('reload: グループを読み、今月の集計・支出を読んで、まとめて反映する', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const done = loader.reload(false);
    // グループを読むまで、月は読まない（選べる月は、一覧で決まる）
    assert.equal(monthCalls.length, 0);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    assert.equal(monthCalls[0]?.month, '2026-11');
    // 月が届くまでは、何も反映しない（一部だけの画面を出さない）
    assert.equal(loader.getState().group, null);
    monthCalls[0]!.result.resolve(monthData('2026-11', 128450));
    await done;
    const state = loader.getState();
    assert.equal(state.selected, '2026-11');
    assert.equal(state.group?.group.name, 'ふたりの生活費');
    assert.equal(state.monthData?.summary.totalMinor, 128450);
    assert.equal(state.error, null);
    assert.equal(state.refreshing, false);
    assert.ok(currentMonthData(state));
  });

  it('reload: 選んでいた月を保つ。一覧から無くなっていれば今月へ戻す', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const select = loader.selectMonth('2026-10');
    monthCalls[1]!.result.resolve(monthData('2026-10'));
    await select;
    assert.equal(loader.getState().selected, '2026-10');

    // 取り直し: 選んでいた10月を保つ
    const second = loader.reload(false);
    groupCalls[1]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    assert.equal(monthCalls[2]?.month, '2026-10');
    monthCalls[2]!.result.resolve(monthData('2026-10'));
    await second;
    assert.equal(loader.getState().selected, '2026-10');

    // 10月が一覧から無くなった: 今月へ戻す
    const third = loader.reload(false);
    groupCalls[2]!.resolve(groupData(['2026-11'], '2026-11'));
    await tick();
    assert.equal(monthCalls[3]?.month, '2026-11');
    monthCalls[3]!.result.resolve(monthData('2026-11'));
    await third;
    assert.equal(loader.getState().selected, '2026-11');
  });

  it('selectMonth: 選んだ月へ移り、その月のデータが届くまで、前の月のデータを「選んだ月のもの」として出さない', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const select = loader.selectMonth('2026-10');
    // 切り替えた直後: 選んだ月は10月、データはまだ11月のまま
    assert.equal(loader.getState().selected, '2026-10');
    assert.equal(loader.getState().monthData?.summary.month, '2026-11');
    assert.equal(currentMonthData(loader.getState()), null);
    // グループの一覧は読み直さない
    assert.equal(groupCalls.length, 1);
    monthCalls[1]!.result.resolve(monthData('2026-10'));
    await select;
    assert.equal(currentMonthData(loader.getState())?.summary.month, '2026-10');
  });

  it('月を素早く切り替えたとき、前の月の遅い応答は捨てる', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const toOct = loader.selectMonth('2026-10');
    const toSep = loader.selectMonth('2026-09');
    // 新しい9月の応答が先に届き、そのあとで古い10月の応答が届く
    monthCalls[2]!.result.resolve(monthData('2026-09', 900));
    await toSep;
    monthCalls[1]!.result.resolve(monthData('2026-10', 1000));
    await toOct;
    const state = loader.getState();
    assert.equal(state.selected, '2026-09');
    assert.equal(state.monthData?.summary.totalMinor, 900);
    assert.equal(currentMonthData(state)?.summary.month, '2026-09');
  });

  it('古い応答の失敗も捨てる（新しい読み込みの表示に、前の失敗を出さない）', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const toOct = loader.selectMonth('2026-10');
    const toSep = loader.selectMonth('2026-09');
    monthCalls[1]!.result.reject(new AuthError('network'));
    await toOct;
    assert.equal(loader.getState().error, null);
    monthCalls[2]!.result.resolve(monthData('2026-09'));
    await toSep;
    assert.equal(loader.getState().error, null);
    assert.equal(currentMonthData(loader.getState())?.summary.month, '2026-09');
  });

  it('reload の途中で月を切り替えたら、reload の結果は捨てる', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const reload = loader.reload(false);
    const select = loader.selectMonth('2026-10');
    // 古い reload のグループ・月の応答が、あとから届く
    groupCalls[1]!.resolve(groupData(MONTHS, '2026-11', '古い名前'));
    await tick();
    assert.equal(monthCalls.length, 2, '古い reload は、月を読みに進まない');
    monthCalls[1]!.result.resolve(monthData('2026-10'));
    await select;
    await reload;
    assert.equal(loader.getState().group?.group.name, 'ふたりの生活費');
    assert.equal(loader.getState().selected, '2026-10');
  });

  it('取り直しの失敗は、表示中のデータを残して、文言だけを入れる。次に成功すれば消える', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11', 500));
    await first;

    const failing = loader.reload(false);
    groupCalls[1]!.reject(new AuthError('network'));
    await failing;
    const failed = loader.getState();
    assert.equal(failed.error, '失敗:network');
    assert.equal(failed.monthData?.summary.totalMinor, 500);
    assert.ok(currentMonthData(failed), '表示中のデータは、そのまま出せる');

    const retry = loader.reload(false);
    groupCalls[2]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[1]!.result.resolve(monthData('2026-11', 600));
    await retry;
    assert.equal(loader.getState().error, null);
    assert.equal(loader.getState().monthData?.summary.totalMinor, 600);
  });

  it('月の切り替えが失敗したら、選んだ月のデータは無いまま（前の月のデータを出さない）。もう一度で、選んだ月を読む', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const select = loader.selectMonth('2026-09');
    monthCalls[1]!.result.reject(new AuthError('unavailable'));
    await select;
    assert.equal(loader.getState().error, '失敗:unavailable');
    assert.equal(loader.getState().selected, '2026-09');
    assert.equal(currentMonthData(loader.getState()), null);

    // 「もう一度」は reload。選んだ9月を読み直す
    const retry = loader.reload(false);
    groupCalls[1]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    assert.equal(monthCalls[2]?.month, '2026-09');
    monthCalls[2]!.result.resolve(monthData('2026-09'));
    await retry;
    assert.equal(loader.getState().error, null);
    assert.equal(currentMonthData(loader.getState())?.summary.month, '2026-09');
  });

  it('何も読めていないうちの失敗は、データなしで文言だけを入れる', async () => {
    const { loader, groupCalls } = setup();
    const done = loader.reload(false);
    groupCalls[0]!.reject(new AuthError('unauthorized'));
    await done;
    assert.equal(loader.getState().error, '失敗:unauthorized');
    assert.equal(loader.getState().group, null);
    assert.equal(currentMonthData(loader.getState()), null);
  });

  it('引っ張って更新: 終わるまで refreshing。成功しても失敗しても false に戻る', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const ok = loader.reload(true);
    assert.equal(loader.getState().refreshing, true);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await ok;
    assert.equal(loader.getState().refreshing, false);

    const ng = loader.reload(true);
    assert.equal(loader.getState().refreshing, true);
    groupCalls[1]!.reject(new AuthError('network'));
    await ng;
    assert.equal(loader.getState().refreshing, false);
  });

  it('引っ張って更新の途中で月を切り替えても、refreshing が true のまま残らない', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const first = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await first;

    const pulled = loader.reload(true);
    assert.equal(loader.getState().refreshing, true);
    const select = loader.selectMonth('2026-10');
    monthCalls[1]!.result.resolve(monthData('2026-10'));
    await select;
    assert.equal(loader.getState().refreshing, false);
    // 古い引っ張り更新が、あとから終わっても、状態は変わらない
    groupCalls[1]!.resolve(groupData(MONTHS, '2026-11', '古い名前'));
    await pulled;
    assert.equal(loader.getState().refreshing, false);
    assert.equal(loader.getState().group?.group.name, 'ふたりの生活費');
  });

  it('引っ張って更新の途中で、別の取り直しが始まっても、refreshing が true のまま残らない', async () => {
    const { loader, groupCalls, monthCalls } = setup();
    const pulled = loader.reload(true);
    const focus = loader.reload(false);
    groupCalls[0]!.resolve(groupData(MONTHS, '2026-11'));
    groupCalls[1]!.resolve(groupData(MONTHS, '2026-11'));
    await tick();
    assert.equal(monthCalls.length, 1, '古い reload は、月を読みに進まない');
    monthCalls[0]!.result.resolve(monthData('2026-11'));
    await Promise.all([pulled, focus]);
    assert.equal(loader.getState().refreshing, false);
    assert.ok(currentMonthData(loader.getState()));
  });

  it('購読を解除すると、通知されない（画面が外れたあとの更新で、何も起きない）', async () => {
    const { loader, groupCalls } = setup();
    let count = 0;
    const unsubscribe = loader.subscribe(() => {
      count += 1;
    });
    const done = loader.reload(true);
    assert.ok(count > 0);
    unsubscribe();
    const before = count;
    groupCalls[0]!.reject(new AuthError('network'));
    await done;
    assert.equal(count, before);
  });
});

describe('currentMonthData', () => {
  const state = (patch: Partial<HomeLoadState>): HomeLoadState => ({ ...INITIAL_HOME_STATE, ...patch });

  it('集計と支出の両方が、選んだ月のものであるときだけ返す', () => {
    const group = groupData(MONTHS, '2026-11');
    const data = monthData('2026-11');
    assert.equal(currentMonthData(state({ group, selected: '2026-11', monthData: data })), data);
    assert.equal(currentMonthData(state({ group, selected: '2026-10', monthData: data })), null);
    assert.equal(currentMonthData(state({ group: null, selected: '2026-11', monthData: data })), null);
    assert.equal(currentMonthData(state({ group, selected: null, monthData: data })), null);
    assert.equal(currentMonthData(state({ group, selected: '2026-11', monthData: null })), null);
    // 集計は選んだ月でも、支出の月が違うデータは出さない
    const mixed: HomeMonthData = { summary: data.summary, expenses: { ...data.expenses, month: '2026-10' } };
    assert.equal(currentMonthData(state({ group, selected: '2026-11', monthData: mixed })), null);
  });
});
