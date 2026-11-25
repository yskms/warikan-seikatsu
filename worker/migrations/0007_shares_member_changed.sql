-- メンバーの増減で割合を均等に戻した印（お知らせ「メンバーが増減した」。docs/backend-design.md 5章の「参加」・12章）。
--
-- 一度本番へ適用したマイグレーションは書き換えない。スキーマを変えるときは、次の番号の
-- ファイルを足す（`npm run migrations:create -- <名前>`）。
--
-- `member_changed_at`: メンバーの増減（参加・脱退の確定・アカウント削除）で、この月の割合を均等に戻した時刻（Unixエポックの
-- ミリ秒）。まだ誰も見直していなければ入っている。NULL は、手で保存した行・費目を作ったときに書いた行（印なし）。
-- - その行を書き直す操作（割合を直す `PUT`）は、行を消して書き直すので、印も自然に消える。
-- - 見直しの確認（`POST /groups/:id/category-shares/acknowledge-reset`）は、印を一括で消す。割合は変えない。
-- 行が無い月は、その月以前で最も新しい行を引き継ぐ（3章）ので、印も、引き継ぐ側の行のものを見る。

ALTER TABLE category_month_settings ADD COLUMN member_changed_at INTEGER;
