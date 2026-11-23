// 入力の上限。DDLのCHECK（migrations/）と同じ値を、ここ1か所にまとめる（docs/backend-design.md 2章、付録A）。

/** 1件の金額の上限（通貨の最小単位）。JPYで1兆円。 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

/** 支出・固定費の内容の最大文字数（Unicodeのコードポイント数。SQLite の length() と同じ数え方）。 */
export const MAX_DESCRIPTION_LENGTH = 100;

/** メンバーの表示名の最大文字数（Unicodeのコードポイント数。DDLの `group_members.display_name` のCHECKと同じ）。 */
export const MAX_DISPLAY_NAME_LENGTH = 20;

/** グループ名の最大文字数（コードポイント数。DDLの `expense_groups.name` のCHECKと同じ）。 */
export const MAX_GROUP_NAME_LENGTH = 30;

/** 費目の名前の最大文字数（コードポイント数。DDLの `categories.name` のCHECKと同じ）。 */
export const MAX_CATEGORY_NAME_LENGTH = 20;

/**
 * 1つのグループの人数（今月以降もいるメンバー。脱退が確定した・脱退月が終わった人は数えない。membership.ts の
 * `countSeatedMembers`）。同棲・夫婦の2人が基本で、ルームシェアの3〜4人までを想定する。月締め・自動登録のD1の
 * クエリ数と、精算の送金の件数は、人数で増える（docs/backend-design.md 5章。月締めは、6人で実測している）。
 * 超えると、招待の発行と参加を 409 `group_full` で断る。上げるときは、月締めと自動登録のクエリ数を測り直す。
 */
export const MAX_MEMBERS_PER_GROUP = 5;

/**
 * 1つのグループが持てる費目の数（アーカイブ済みを含む）。仮の値。月締めの書き込みは費目の数に応じて増える
 * （docs/backend-design.md 9章。費目30・メンバー6で、前の月の行を引き継ぐ月（よくある月）の月締めは実測47でFreeの上限（50）に
 * ぎりぎり収まるが、脱退の確定を含む月締めは65（締める月に行がある月でも53）で超える。この数は、batch の文を1つずつ数えた、安全側のもの
 * （公式のとおり batch を1回と数えるなら、収まる。docs/backend-design.md 8章の「D1のクエリ数の数え方」）。1文ずつ数える見積もりでは、Freeに収まらない（Paidへ移すかは未決。docs/backend-design.md 12章）。
 * 上限やメンバー数を増やすときは、worker/test/closings.test.ts の「費目の上限(30)・メンバー6人」を測り直す）。
 */
export const MAX_CATEGORIES_PER_GROUP = 30;

/**
 * 1つのグループが持てる固定費の数（終了・停止したものを含む。一度でも支出を作ったテンプレートは物理削除しない）。仮の値。
 * 自動登録のCronは、グループごとに全テンプレートの負担設定を読み、書く行も固定費に比例して増える（docs/backend-design.md 7章）。
 * 1回に作る件数は、D1のクエリ数の予算に収まる分に区切る（残りは次の回）ので、この上限は、読む量の歯止め。
 * 一度も支出を作っていない固定費は削除できる（9章）が、作ったものは残る。
 */
export const MAX_RECURRING_EXPENSES_PER_GROUP = 50;
