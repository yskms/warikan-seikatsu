// ストア用のスクリーンショットを撮るときだけ、アプリの `fetch` とログイン状態を、偽のものに差し替える（`entry.js` が最初に読む）。
// 出荷するビルドには入れない（`fakeServer.js` の先頭）。
//
// 順序が大事: `platform/*Service.ts` は、読み込まれたときの `fetch` を Repository に渡して持つ。だから、`fetch` の差し替えは、
// それらを読み込むより前に済ませる（ここで `require` するのは、そのため。`import` は巻き上げられて、順序を保てない）。
/* eslint-disable @typescript-eslint/no-require-imports */
const { fakeFetch } = require('./fakeServer.js');

globalThis.fetch = fakeFetch;

// ログイン済みにする（端末の保存領域・サーバーの認証は通さない）。画面は `accountService` を、API を呼ぶ層は `sessionAccess` を使う。
const { accountService, sessionAccess } = require('../../platform/accountService.ts');
accountService.getSignedInProvider = async () => 'google';
sessionAccess.withSession = (task) => task('A'.repeat(43));
