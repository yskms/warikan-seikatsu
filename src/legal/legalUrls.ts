// アプリから開く、法務のページのURL。ストアの掲載情報に入れるURLと同じにする（App Store Review Guidelines 5.1.1(i) は、
// プライバシーポリシーへのリンクを、ストアの掲載情報とアプリの中の両方に求める）。
//
// **まだ、公開するページが無い**（docs/plan.md: 招待URL・プライバシーポリシー・アカウント削除の案内の静的なWebページ）。
// そのあいだは仮の値（`.invalid`）にしてあり、画面は、仮の値のリンクを出さない（開いても、名前が引けないため）。
// 公開したら、ここを実際のURLに置き換える。リリース前に、仮の値が残っていないことを確かめる。
export const PRIVACY_POLICY_URL = 'https://not-created-yet.invalid/privacy-policy';
export const TERMS_OF_SERVICE_URL = 'https://not-created-yet.invalid/terms';

/** 仮の値（まだ公開していないページ）か。 */
export function isPlaceholderUrl(url: string): boolean {
  return new URL(url).hostname.endsWith('.invalid');
}
