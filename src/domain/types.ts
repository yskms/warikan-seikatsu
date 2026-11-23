// アプリ全体で使う型。いまはログイン手段だけ（支出・グループなどは、画面を作るときに足す）。
// Singfolio（src/domain/types.ts）の `AuthProvider` のコピー（コピー元: singfolio 4b70ba4）。

/**
 * アカウントのログイン手段（iOS・Androidとも、AppleとGoogle）。Workerの `provider` と同じ文字列。
 * 同じ人でも手段が違えば別のアカウントになる（自動ではつながない。docs/backend-design.md 9章の「認証API」）。
 */
export const AUTH_PROVIDERS = ['apple', 'google'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function isAuthProvider(value: unknown): value is AuthProvider {
  return AUTH_PROVIDERS.some((provider) => provider === value);
}
