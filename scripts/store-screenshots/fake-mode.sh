#!/bin/zsh
set -euo pipefail

# ストア用のスクリーンショットを撮るための、偽のサーバーの入口を、アプリに入れる・外す。
#   fake-mode.sh on   ... package.json の main を、偽の入口（scripts/store-screenshots/entry.js）にする
#   fake-mode.sh off  ... main を、ふだんの入口（expo-router/entry）へ戻す
#   fake-mode.sh      ... 今の main を表示する
#
# **撮り終えたら、必ず off に戻す。** on のまま、ストア用のビルドを作ると、偽のデータだけを表示するアプリが出荷される
# （`src/appConfig.test.ts` が、main が `expo-router/entry` であることを、`npm test` で確かめる）。
cd "${0:A:h}/../.."
case "${1:-}" in
  on) npm pkg set main=./scripts/store-screenshots/entry.js >/dev/null ;;
  off) npm pkg set main=expo-router/entry >/dev/null ;;
  "") ;;
  *) print -u2 "使い方: fake-mode.sh [on|off]"; exit 2 ;;
esac
print "main = $(node -p "require('./package.json').main")"
