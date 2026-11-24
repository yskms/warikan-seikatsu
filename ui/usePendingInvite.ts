// 参加の確認を待っている招待のトークン（`platform/inviteLink.ts`）と、起動したときのURLを読み終えたかを、画面から読む。
import { useSyncExternalStore } from 'react';

import { linksReady, pendingInvite } from '../platform/inviteLink.ts';

/** 参加の確認を待っている招待のトークン。無ければ `null`。変わったら、画面が描き直される。 */
export function usePendingInvite(): string | null {
  return useSyncExternalStore(pendingInvite.subscribe, pendingInvite.get, () => null);
}

/** 起動したときのURLを、読み終えたか（`platform/inviteLink.ts`）。読み終えるまで、ログイン後の分岐を動かさない。 */
export function useInviteLinksReady(): boolean {
  return useSyncExternalStore(linksReady.subscribe, linksReady.get, () => false);
}
