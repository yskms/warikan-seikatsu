// 「このアプリについて」（docs/screens.md 6章）の、画面に出す内容を決める。RN・Expoに触れない（Nodeのテストから実行する）。
import { isPlaceholderUrl } from '../legal/legalUrls.ts';

export interface AboutUrls {
  privacyPolicy: string;
  termsOfService: string;
  contact: string;
}

export interface AboutLink {
  key: 'privacyPolicy' | 'termsOfService' | 'contact';
  label: string;
  url: string;
}

/**
 * 画面に出すリンク。**まだ公開していないページ（仮の値）は、出さない**（開いても、名前が引けず、開けない。ログイン画面と同じ扱い。
 * `src/legal/legalUrls.ts`）。公開したあとは、URLを置き換えるだけで、行が出る。
 */
export function buildAboutLinks(urls: AboutUrls): AboutLink[] {
  const links: AboutLink[] = [
    { key: 'privacyPolicy', label: 'プライバシーポリシー', url: urls.privacyPolicy },
    { key: 'termsOfService', label: '利用規約', url: urls.termsOfService },
    { key: 'contact', label: 'お問い合わせ', url: urls.contact },
  ];
  return links.filter((link) => !isPlaceholderUrl(link.url));
}

/** バージョンの表示。読めなかったとき（`null`・空）は、「不明」とする（行ごと消さず、報告の手がかりとして残す）。 */
export function versionLabel(version: string | null | undefined): string {
  const trimmed = version?.trim();
  return trimmed ? trimmed : '不明';
}
