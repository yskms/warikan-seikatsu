// ストア用のスクリーンショットを撮るときだけ使う、アプリの入口（`fake-mode.sh on` が、`package.json` の `main` に指定する）。
// 偽のサーバーを差し込んでから、ふだんの入口（`expo-router/entry`）を読む。
import './fake.js';
import 'expo-router/entry';
