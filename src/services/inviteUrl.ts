// 招待URLと、共有する文面。
//
// URLの置き場は、本番のドメイン `warikan-seikatsu.app`（Workerの独自ドメインと同じ）。Workerが `/invite/<token>` の案内ページと、
// `apple-app-site-association`・`assetlinks.json` を返し（`worker/src/site.ts`）、`app.json` に `associatedDomains`・`intentFilters` がある。
// **このドメインが招待URLを開けなくなる変更（Workerの案内ページ・設定ファイル・`app.json` の設定を外す、など）をしたら、
// 先にここを仮の値（`.invalid`）に戻す**（戻さないと、メンバーと招待の画面が、開けない招待URLをメッセージアプリへ送ってしまう。
// `npm run release-check` は、`.invalid` が無いことしか見ないので、気づけない）。置き場の条件:
// - **HTTPSの、メッセージアプリで押せるURL**にする（`warikan-seikatsu://` のような独自スキームは、LINEなどで押せない）。
//   iOSのUniversal LinksとAndroidのApp Linksで、アプリが入っていれば直接アプリが開き、入っていなければ、ストアへ案内する
//   Webページが開くようにする（`app.json` の `associatedDomains`・`intentFilters` と、ドメインの
//   `apple-app-site-association`・`assetlinks.json` が要る）。
// - 道は `/invite/<token>` にする（`inviteUrl`）。トークンは、この道の最後の1区切り。
// リリース前に、`npm run release-check` で、仮の値が残っていないことを確かめる（`legalUrls.ts` と同じ）。
import { isPlaceholderUrl } from '../legal/legalUrls.ts';

export const INVITE_URL_ORIGIN = 'https://warikan-seikatsu.app';

/** 招待のURL。トークンは、URLに載せて壊れない文字（base64url）だが、念のため符号化する。 */
export function inviteUrl(token: string, origin: string = INVITE_URL_ORIGIN): string {
  return `${origin.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`;
}

/** 招待URLの置き場が、まだ決まっていない仮の値か。 */
export function isInviteOriginPlaceholder(origin: string = INVITE_URL_ORIGIN): boolean {
  return isPlaceholderUrl(origin);
}

/**
 * 共有シートに渡す文面（docs/screens.md 6章）。URLは文面の末尾に置く（メッセージアプリが、URLをリンクとして認識する）。
 * 有効期間は発行から3日（`worker/src/invites.ts`）。
 */
export function inviteShareMessage(url: string): string {
  return `わりかん生活で生活費を一緒に記録しよう。このURLから参加できます（3日間有効）\n${url}`;
}
