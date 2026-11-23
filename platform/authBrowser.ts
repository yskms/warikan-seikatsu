// AndroidのAppleログイン（Web経由）が使う、ブラウザ（Custom Tab）・URLの受け取り・前面への復帰。
// `src/repositories/appleWebSignInRepository.ts` の `AuthBrowser` を、expo-web-browser・Linking・AppState で実装する。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// Singfolio（src/services/index.ts の `authBrowser`）からのコピーを元にした（コピー元: singfolio 9aaef21）。
//
// ブラウザは、expo-web-browser の `openBrowserAsync`（Androidでは、開いた時点で解決する）。戻りのURLは、
// `warikan-seikatsu://auth/apple?...` でアプリが開き、Linking に届く（expo-router には `app/+native-intent.tsx` で、
// 画面への遷移をさせない）。`openAuthSessionAsync` は使わない（Androidでは、リダイレクトとブラウザを閉じた判定を
// 競わせるだけで、閉じた判定が勝ちうる）。
//
// オプションは、既定と同じ値を**明示して固定する**。外さない。expo-web-browser は、`useProxyActivity` が真のとき、
// Custom Tab を別のタスク（`.webContainer`）の透過Activityから開き、最近使ったアプリに出して、アプリの外へ移っても
// 破棄しない。偽（旧来の経路）だと、`showInRecents` が偽のときに `EXCLUDE_FROM_RECENTS` と `NO_HISTORY` を付け、
// 最近使ったアプリに出ず、離れると破棄される。Appleの確認コードをSMSで受け取るなど、アプリの外へ移って戻る
// 経路を壊すので、既定が変わっても旧来の経路にならないようにする（Singfolioで、エミュレータで、Home → Settings →
// 最近使ったアプリからの復帰を確認済み）。
import * as WebBrowser from 'expo-web-browser';
import { AppState, Linking } from 'react-native';

import type { AuthBrowser } from '../src/repositories/appleWebSignInRepository.ts';

export const authBrowser: AuthBrowser = {
  open: async (url) => {
    await WebBrowser.openBrowserAsync(url, {
      createTask: true,
      useProxyActivity: true,
      showInRecents: true,
    });
  },
  onUrl: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => subscription.remove();
  },
  onForeground: (listener) => {
    // いったん前面を離れたあとに、前面（active）へ戻ったときだけ。購読の直後の、今の状態の通知は数えない。
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && previous !== 'active') listener();
      previous = state;
    });
    return () => subscription.remove();
  },
};
