// アプリの版（`app.json` の `version`）を読む。「このアプリについて」（docs/screens.md 6章）に出す。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// 読めないときは `null`（表示は `src/services/aboutView.ts` の `versionLabel`）。ビルド番号は出さない（ストアが管理する値で、
// 問い合わせの手がかりには、版で足りる）。
import Constants from 'expo-constants';

export function readAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}
