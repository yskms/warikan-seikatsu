// いま開いているグループ（下のナビの3つの画面が共有する）。`ui/GroupGate.tsx` が所属グループを読んで決め、`app/(main)/_layout.tsx` が
// 値を渡す。複数のグループの切り替えと、最後に開いたグループを覚えることは、まだ作っていない（いまは、作成の古い順の先頭）。
import { createContext, useContext } from 'react';

export interface CurrentGroup {
  id: string;
  name: string;
}

const CurrentGroupContext = createContext<CurrentGroup | null>(null);

export const CurrentGroupProvider = CurrentGroupContext.Provider;

export function useCurrentGroup(): CurrentGroup {
  const group = useContext(CurrentGroupContext);
  if (group === null) throw new Error('useCurrentGroup は、CurrentGroupProvider の中で使う');
  return group;
}
