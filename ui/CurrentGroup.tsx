// いま開いているグループ（下のナビの3つの画面が共有する）。`ui/GroupGate.tsx` が所属グループを読んで決め、`app/(main)/_layout.tsx` が
// 値を渡す。切り替えの候補（`groups`）と切り替える操作（`select`）も持つ（ホームの上部のグループ名から使う。docs/screens.md 1章）。
import { createContext, useContext } from 'react';

export interface GroupOption {
  id: string;
  name: string;
}

export interface CurrentGroup extends GroupOption {
  /** 所属しているグループ（作成の古い順。いまのグループも含む）。1つなら、切り替えの操作は出さない */
  groups: readonly GroupOption[];
  /** 別のグループを開く。画面ごと作り直され、次の起動でもそのグループが開く（`ui/activeGroup.ts` の `openGroup`） */
  select(groupId: string): void;
}

const CurrentGroupContext = createContext<CurrentGroup | null>(null);

export const CurrentGroupProvider = CurrentGroupContext.Provider;

export function useCurrentGroup(): CurrentGroup {
  const group = useContext(CurrentGroupContext);
  if (group === null) throw new Error('useCurrentGroup は、CurrentGroupProvider の中で使う');
  return group;
}
