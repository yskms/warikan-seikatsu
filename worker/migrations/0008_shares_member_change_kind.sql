-- 割合の見直しの印（`member_changed_at`）の種類（お知らせ「メンバーが増減した」。docs/backend-design.md 5章の「参加」・9章）。
--
-- 一度本番へ適用したマイグレーションは書き換えない。スキーマを変えるときは、次の番号の
-- ファイルを足す（`npm run migrations:create -- <名前>`）。
--
-- `member_changed_kind`: 印が付いた理由。
-- - 'reset': メンバーの増減で、この月の割合を均等に戻した（脱退の確定・アカウント削除・1人のグループへの参加）。
-- - 'joined': 2人以上のグループに新しいメンバーが参加して、既存の割合を残し、新しいメンバーを0%で足した。
-- `member_changed_at` が NULL のときは NULL。`member_changed_at` があって、これが NULL の行（0007で付いた印）は、'reset' と
-- 同じに扱う。印を消す操作（割合の保存・見直しの確認）は、2つとも消す。

ALTER TABLE category_month_settings ADD COLUMN member_changed_kind TEXT CHECK (member_changed_kind IN ('reset', 'joined'));
