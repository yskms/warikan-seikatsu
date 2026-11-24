// グループの設定の保存の手順（docs/screens.md 6章の「グループの設定」）。送り先が2つ（グループ名・通貨と、自分の表示名・色）の
// 別の呼び出しなので、**グループ名・通貨 → 自分の表示名・色**の順に送り、途中で失敗したら、そこで止める（済んだ段階と、失敗した段階を
// 返す）。やり直しでは、済んだ段階を取り込んだ基準（`applySaved`）から差分を組み立て直すので、残りだけが送られる。
//
// 順序の理由: グループ名・通貨のほうが、断られる理由が多い（脱退が確定した・通貨が固定された・競合）。先に送れば、断られたときに、
// 何も保存していない状態で止められる。
import type { GroupService } from './groupService.ts';
import { applySaved, type GroupSettingsContext, type GroupSettingsPlan } from './groupSettingsForm.ts';

export type SaveStep = 'group' | 'me';

export type SaveResult =
  | { ok: true; context: GroupSettingsContext }
  | {
      ok: false;
      /** 失敗した段階 */
      step: SaveStep;
      error: unknown;
      /** 済んだ段階を取り込んだ基準（画面は、これを持ち直す） */
      context: GroupSettingsContext;
      /** 失敗する前に、済んだ段階があるか（失敗の文言が、保存できたものを伝えるため） */
      saved: boolean;
      /** 自分の表示名・色を送るはずだったのに、グループ名・通貨の失敗で、送らずに止めたか（失敗の文言が、まだ保存していないことを伝えるため） */
      meNotSent: boolean;
    };

export async function saveSettings(
  service: Pick<GroupService, 'updateGroup' | 'updateMe'>,
  groupId: string,
  plan: GroupSettingsPlan,
  context: GroupSettingsContext,
): Promise<SaveResult> {
  let current = context;
  let saved = false;
  if (plan.group !== null) {
    try {
      await service.updateGroup(groupId, plan.group);
    } catch (error) {
      return { ok: false, step: 'group', error, context: current, saved, meNotSent: plan.me !== null };
    }
    current = applySaved(current, plan, 'group');
    saved = true;
  }
  if (plan.me !== null) {
    try {
      await service.updateMe(groupId, plan.me);
    } catch (error) {
      return { ok: false, step: 'me', error, context: current, saved, meNotSent: false };
    }
    current = applySaved(current, plan, 'me');
  }
  return { ok: true, context: current };
}
