// アプリから開く、法務のページのURL。ストアの掲載情報に入れるURLと同じにする（App Store Review Guidelines 5.1.1(i) は、
// プライバシーポリシーへのリンクを、ストアの掲載情報とアプリの中の両方に求める）。
//
// ページは、Workerの静的アセット（`worker/public/`。本番のドメイン `warikan-seikatsu.app`）。デプロイするまで、開けない。
// 画面は、仮の値（`.invalid`）のリンクを出さない仕組みのまま残してある（`isPlaceholderUrl`）。リリース前に、`npm run release-check` で、
// 仮の値が残っていないことを確かめる。
export const PRIVACY_POLICY_URL = 'https://warikan-seikatsu.app/privacy-policy';
export const TERMS_OF_SERVICE_URL = 'https://warikan-seikatsu.app/terms';
// お問い合わせの窓口（静的なWebページ。窓口のメールアドレスは、そのページに書いてある）。`isPlaceholderUrl` は https のURLの
// ホスト名で見分けるので、`mailto:` にするときは、その見分けも直す。
export const CONTACT_URL = 'https://warikan-seikatsu.app/contact';

/** 仮の値（まだ公開していないページ）か。 */
export function isPlaceholderUrl(url: string): boolean {
  return new URL(url).hostname.endsWith('.invalid');
}
