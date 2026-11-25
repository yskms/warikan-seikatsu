// 招待URLの案内ページ（invite.html）。URLの最後の区切り（招待のトークン）を読み、「アプリで開く」のボタンを、
// アプリのURLスキーム（warikan-seikatsu://invite/<トークン>。app.json の scheme と、アプリの parseInviteLink が受ける形）にする。
// URLの形が正しくないときは、本文を隠して、その旨だけを出す（本文は「このURLから参加できます」と案内するので、矛盾して見える）。
// トークンは、このページの外へ、送らない（ネットワークの呼び出しも、保存も、しない。CSPで、外への通信を禁止している）。
(function () {
  var match = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
  var button = document.getElementById('open-app');
  var invalid = document.getElementById('invalid');
  var content = document.getElementById('content');
  if (match === null) {
    if (invalid) invalid.hidden = false;
    if (content) content.hidden = true;
    return;
  }
  if (button) {
    button.setAttribute('href', 'warikan-seikatsu://invite/' + match[1]);
    button.hidden = false;
  }
})();
