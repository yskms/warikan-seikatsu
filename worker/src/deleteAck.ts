// 「グループのデータがすべて消えることを、利用者が確認した」という申告（クエリ `acknowledgeDelete=true`）。
//
// 脱退を選ぶ（`POST /groups/:id/leave`）と月締め（`POST /groups/:id/months/:month/close`）は、最後の1人の脱退が確定するとき、
// グループのデータをすべて消す（5章「グループの削除」）。アプリは、確認の画面で `deleteGroup` 系の値（グループ情報の
// `leaveDeletesGroup`、集計の `close.deletesGroup`）を見て警告を出すが、画面を読んでから押すまでのあいだに、他のメンバーが脱退済み・
// 削除済みになると、警告の無い確認のまま、グループが消えてしまう（取り消せない）。そのため、**この申告が無いまま、消すことになった
// ときは、何も消さずに409 `delete_not_acknowledged` を返す**。アプリは、読み直して、警告つきの確認を出し直す。
// 申告は、警告を見せたアプリだけが付ける。付けても、消えない操作には効かない（無視する）。
// 月初のCron（確定の `confirmEndedLeaves`）は、利用者の操作ではないので、この申告の対象外（docs/backend-design.md 5章）。
//
// 本文ではなくクエリにしたのは、本文の無いPOSTを、そのまま使えるようにするため（`readJsonObject` は、本文が無いと400にする）。
import { conflict } from './http.ts';

export function acknowledgesDelete(request: Request): boolean {
  return new URL(request.url).searchParams.get('acknowledgeDelete') === 'true';
}

/** 消すことになったのに、申告が無いときの応答。 */
export const deleteNotAcknowledged = (): Response => conflict('delete_not_acknowledged');
