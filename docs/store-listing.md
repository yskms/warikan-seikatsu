# わりかん生活 ストア掲載情報

App Store（iOS）と Google Play（Android）の掲載文・申告の内容。仕様の正は [plan.md](plan.md)・[screens.md](screens.md)・公開しているプライバシーポリシー（`worker/public/privacy-policy.html`）。機能を変えたら、ここも直す。

**これは下書き（2026-11-26）。** 提出の画面の質問文を読んで決めることは、「決めること」と書いた。確かめていないことは、確かめていないと書いた。

- 掲載文に書くのは、**アプリにある機能だけ**。書かないもの: Premium・広告（どちらもリリース後に導入。plan.md 10章）、履歴を見られる期間の制限、ログインなしのお試し（未実装。screens.md 1章）、Web版、銀行・カードの連携、レシートの読み取り、実際の送金・決済（このアプリは金額の計算だけで、送金は扱わない）。
- 広告とアクセス解析を使っていないことは、掲載文にもプライバシーの申告にも書く。**広告を入れる版では、掲載文・申告・プライバシーポリシーを、入れる前に直す**（ポリシーに、そう書いてある）。
- 名前に「同棲」「折半」が入らないので、サブタイトル・キーワード・説明文で補う（plan.md 14章）。

## 1. 共通

| 項目 | 内容 |
|---|---|
| アプリ名 | わりかん生活 |
| 言語 | **日本語のみ**。アプリの画面が日本語だけ（多言語化の仕組みが無い）ので、英語の掲載文は作らない。英語の画面を作るときに、足す |
| カテゴリ | App Store: ファイナンス（副: ライフスタイル）/ Google Play: ファイナンス。**決めること**: 家計・精算のアプリなので、これを第一案にする。ライフスタイルにする案もある |
| サポートURL | `https://warikan-seikatsu.app/contact` |
| マーケティングURL | `https://warikan-seikatsu.app/` |
| プライバシーポリシーURL | `https://warikan-seikatsu.app/privacy-policy` |
| 利用規約URL | `https://warikan-seikatsu.app/terms` |
| 問い合わせ先のメール | `support@warikan-seikatsu.app`（ポリシーに載せているもの） |
| 提供者 | yskms |
| 価格・内課金・広告 | 無料。アプリ内課金なし。広告なし |
| 対応端末 | iPhoneのみ（`ios/` の `TARGETED_DEVICE_FAMILY = 1`。iPadのスクリーンショットは要らない）。iOS 16.4以上。Android |
| 人数 | グループは5人まで |
| 通貨 | 日本円のほか、米ドル・ユーロなど8通貨（`worker/src/currencies.ts`）。グループごとに選ぶ |

URLのページは、Workerの静的アセット（`worker/public/`）で、本番のドメインで公開済み（2026-11-26）。ストアの掲載情報に入れるURLと、アプリの中のリンク（`src/legal/legalUrls.ts`）は同じ値。

## 2. App Store（iOS）

文字数の上限は、App Store Connect の制限（名前・サブタイトルは30、プロモーション用テキストは170、説明は4000、キーワードは100、いずれも文字数）。

- **名前**（6）: `わりかん生活`
- **サブタイトル**（20）: `同棲・夫婦の生活費を、割合で月ごとに精算`
- **プロモーション用テキスト**（89）: `家賃は7:3、食費は半分ずつ。費目ごとに負担割合を決めておけば、支出を記録するだけで、月末に「誰が誰にいくら」が分かります。iPhoneとAndroidの組み合わせでも使えます。`
- **キーワード**（55）: `折半,割り勘,カップル,ルームシェア,家計簿,家計,共有,共同,ふたり,固定費,繰越,支出,記録,負担,シェア`
  - 名前・サブタイトルにある語（わりかん・生活・同棲・夫婦・生活費・割合・精算）は、重ねない。
  - 「家計簿」は、検索される語として入れる。説明では、個人の家計簿ではないことを書く（誤解させないため）。
- **説明**:

```text
わりかん生活は、一緒に暮らす人との共同の生活費を記録して、決めた負担割合で月ごとに精算するアプリです。同棲カップル、夫婦、ルームシェアなど、2人から5人まで使えます。

財布や口座は、別々のままで大丈夫。共同で使ったお金だけを、それぞれが記録します。月末には、誰が誰にいくら払えばよいかが分かります。実際の送金や決済は扱いません。

できること
• 費目ごとに、負担割合を決められます。家賃は7:3、食費は5:5のように、一度決めれば、支出のたびに入力する必要はありません
• 上限額つきの負担。「外食は月1万円まで自分が払い、超えた分は割合で分ける」といった決め方もできます
• この支出だけ負担を変えたいときは、割合・均等・金額を指定・1人が全額、から選べます
• 家賃やサブスクなど、毎月の支出は固定費として自動で登録
• 電卓つきのキーパッドで、金額を計算しながら入力
• 月ごとに集計して、月を締めると、送金の一覧（誰が誰にいくら）が確定します
• 送金ごとに「精算する」か「次の月に繰り越す」かを選べます。今月の分を、来月にまとめて精算することもできます
• 3人以上でも使えます（5人まで）。iPhoneとAndroidの組み合わせでも使えます
• 通貨は、グループごとに選べます（日本円、米ドルなど）
• ライトモード・ダークモードに対応

はじめかた
1. AppleまたはGoogleでログイン
2. グループを作って、費目と負担割合を決める
3. 招待URLを送って、相手に参加してもらう
4. 共同で使ったお金を、それぞれ記録する
5. 月末に締めて、精算する

安心して使うために
• AppleやGoogleのアカウントの名前・メールアドレスは、アプリでは使わず、保存しません
• 広告も、アクセス解析もありません
• 招待URLは、1回しか使えず、3日で無効になります。開いただけでは参加しません
• アカウントは、アプリの中からいつでも削除できます

銀行口座やクレジットカードとの連携、レシートの読み取りはありません。個人の家計簿ではなく、共同で使ったお金だけを管理するためのアプリです。
```

### リリースノート（1.0.0）

`初回リリース。`

### 年齢指定（Age Rating）

**決めること（提出の画面の質問文を読んで）。** 想定:

- 暴力・性的な表現・不適切な言葉・薬物・ギャンブルなどは、すべて「なし」。広告は「いいえ」（広告を表示しない）。「制限のないWebアクセス」は「いいえ」（アプリの中にブラウザを持たない。ポリシーや規約は、外部のブラウザで開く）。
- **ユーザー生成コンテンツ・メッセージ**: 利用者が入力した文字（グループ名・表示名・費目名・支出の内容）は、同じグループのメンバー（最大5人。招待したい人だけ）に見える。公開されず、検索もなく、メンバー間のメッセージ機能も無い。質問文の定義（他の利用者に見える内容か）を読んで答える。「はい」になる場合は、ガイドライン 1.2（通報・ブロックなど）が関わるかを確かめる。通報・ブロックの機能は、作っていない。

### 輸出コンプライアンス

`app.json` の `ios.config.usesNonExemptEncryption: false`（通信は標準のHTTPSだけで、独自の暗号化は無い）。App Store Connect の質問にも、同じ答え（免除される暗号化のみ）で答える。

### App Review のメモ

App Store Connect の「App Review に関する情報」の「メモ」（4,000文字まで）に、次の英文を入れる。サインインは必要なので、「サインインが必要です」はオンにして、**審査用のGoogleアカウントを2つ**（A・B。下の「審査用アカウント」）の、ユーザー名とパスワードを入れる（**IDとパスワードは、この欄にだけ書く。リポジトリには書かない**）。iOSにも「Googleでログイン」があるので、同じアカウントを、AppleとGoogleの審査で使える。審査する人が、自分のAppleアカウントでサインインしてもよい。

```text
Warikan Seikatsu is an app for people who share living costs (couples, spouses, roommates). Members record shared expenses, set how each expense category is split (for example 70:30 for rent), close the month, and see who should pay whom. The app only calculates amounts. It does not move money, link bank accounts, or take payments. The screens are in Japanese only.

Sign-in is required. Two demo Google accounts (A and B) are given in the sign-in information fields. Tap "Googleでログイン" (Sign in with Google) and choose a demo account. Both accounts are already members of one group ("ふたりの生活費") with sample data, so you can see a two-person settlement by signing in as A, and as B after signing out (Settings > "ログアウト"). You can also use your own Apple or Google account; a new group then has only one member. The server stores only an opaque account identifier; it stores no name or email address.

How to try it:
1. Sign in, then enter a group name and your display name. The group is created with default categories (rent, food, daily goods, utilities, dining out, communication, other).
2. Tap "+" in the bottom bar to add expenses. Tap a category in the Home breakdown to change its split.
3. With your own account, a two-person settlement needs a second account: open Settings > "メンバーと招待" (Members and invites), issue an invite URL, and open it on another device signed in with another account. Opening the URL alone does not join the group; the person taps "参加する" (Join) on a confirmation screen. The demo accounts above skip this step.
4. On Home, tap "この月を締める" (Close this month) in the settlement card to fix the month's totals. Each transfer can then be marked "精算完了" (settled) or "繰越" (carried over to the next month).

User-generated content: text typed by members (group name, display name, category names, expense descriptions) is visible only to members of the same group (up to 5 people, joined by single-use invite URLs that expire in 3 days). Nothing is public, and there is no messaging or search across users.

Account deletion: Settings > "アカウントを削除" (Delete account). It asks you to sign in again with the same Apple or Google account.

The app has no ads, no in-app purchases, and no tracking. Privacy policy: https://warikan-seikatsu.app/privacy-policy
```

**審査の通りやすさ**: ログインが必要なアプリは、ふつうに審査を通る。このアプリで引っかかりうるのは、1人では精算（誰が誰にいくら）の画面まで試せないこと（ガイドライン 2.1）で、審査用のアカウントを2つ渡して防ぐ（下の「審査用アカウント」）。ログインなしのお試し（未実装）の前倒しは、しない。指摘されてから、検討する（[wbs.md](wbs.md) の6.7）。

### 審査用アカウント

- **作る**: Googleアカウントを2つ（A・B）作る（数分。メールアドレスはGmailでよい）。**2段階認証は付けない**。電話番号の確認を、審査員の端末で求められないようにする（求められると、審査員がログインできない。Googleが、見慣れない端末からのログインを、確認なしで通すとは限らないので、**提出の前に、別の端末で、実際にログインして確かめる**）。
- **データを入れる**: Aでログインして、グループ（名前「ふたりの生活費」）を作り、Bを招待して参加させる。支出を数件入れる（架空の内容。実在の人名・実際の支出は入れない）。精算を試せるよう、前の月を締めて、送金を未処理のまま残す手もある（審査員が精算まで押すと状態が変わるので、**提出のたびに、元の状態へ作り直す**）。
- **ID・パスワードの置き場**: App Store Connect の「サインイン情報」と、Play Console の「アプリのアクセス権」の入力欄だけ。リポジトリ（docs を含む。公開される）にも、privateのリポジトリにも書かない。
- **提出前に必須**: Googleの同意画面が「本番環境（In production）」であること（[wbs.md](wbs.md) の6.6）。「テスト」のままだと、テストユーザー以外はGoogleでログインできず、審査員が入れない。
- **削除**: 審査が済んだら、2つのアカウントを、アプリの中の「アカウントを削除」で消す（グループごと消える）。


### App プライバシー（App Privacy）

**決めること（提出の画面の説明文を読んで）。** 次の4項目を申告する案。トラッキングはしない。他は「収集しない」。

| データの種類 | 収集 | ユーザーに紐付け | トラッキング | 目的 |
|---|---|---|---|---|
| ユーザーID | する | する | しない | アプリの機能 |
| 名前（グループ内の表示名） | する | する | しない | アプリの機能 |
| その他の金融情報（支出・精算の金額） | する | する | しない | アプリの機能 |
| その他のユーザーコンテンツ（グループ名・費目名・支出の内容） | する | する | しない | アプリの機能 |

- **ユーザーID**: サーバーが保存する、AppleまたはGoogleが付ける識別子（`sub`）。
- **名前**: 表示名は、本名でなくてよいが、本名を入れる人もいる。ニックネームが「名前」に当たるかは、説明文で確かめる。当たらないと決めたときは、「その他のユーザーコンテンツ」に含める（どの種類にも入らない状態は作らない）。
- **その他の金融情報**: 支出の金額と、精算・繰越の金額は、「負債」に近い。当たらないと決めた根拠が弱いので、申告する案にしている。
- AppleやGoogleのアカウントの名前・メールアドレスは、サーバーが保存しない（トークンの中を通るだけ。ポリシーのとおり）ので、収集に数えない。Appleの定義で「収集」にならないことを、説明文で確かめる。
- 位置情報・連絡先・写真・購入履歴・診断データ・広告ID・端末の識別子は、取得しない。

**決めること（SDKのプライバシーマニフェスト）**: Googleのサインイン（`modules/warikan-google-signin`。Singfolioと同じ部品）のiOS用 SDK（GoogleSignIn・AppAuth など）は、自分のマニフェストで、名前・メールアドレス・電話番号・おおまかな位置情報・ユーザーID・デバイスID・利用状況などの収集を宣言している（Singfolioが `ios/Pods/` で読んだとき。Singfolioの `docs/singfolio-store-listing.md` の6章に記録がある）。この表で足りるか、次の案から決める。**根拠を確かめずに (A) を採らない**。

- (A) 上の4項目だけにする（Googleが利用者と直接やり取りする範囲は、Googleの扱い、と読む）
- (B) SDKのマニフェストの種別も申告する（サードパーティのコードが収集するデータも対象、というAppleの説明に沿う。ラベルは大きくなる）
- (C) iOSのGoogleサインインを外し、iOSはAppleだけにする（ガイドライン 4.8は、Sign in with Appleを出していれば満たす。Androidは両方のまま）

参考: ほかのアプリで、Googleサインインを入れた版を出した前例は、まだ無い（Singfolioは、部品は入っているが、アカウント機能を閉じていて、同じ判断が保留のまま）。App プライバシーの回答は、App Store Connect で、新しい版を出さずに直せる（私の理解。現行の画面で確かめる）ので、最初の提出では、判断がつく案で出して、あとから直せる。

このアプリで `ios/Pods/` の `PrivacyInfo.xcprivacy` を読み直して、決める（Singfolioで読んだのは2026-11-18の版。版が変わっていないか見る）。

### そのほか（App Store）

- **Sign in with Apple（4.8）**: サードパーティのログイン（Google）を出すので、Appleのサインインも同等に出している（iOSは `AppleAuthenticationButton`、AndroidはWeb経由）。
- **アカウントの削除（5.1.1(v)）**: 設定の「アカウントを削除」から、アプリの中で始められる（再認証つき）。
- **プライバシーポリシーへのリンク（5.1.1(i)）**: ストアの掲載情報と、アプリの中（設定の「このアプリについて」、ログイン画面）の両方にある。
- **App Store Connect の Sign in with Apple・Associated Domains の設定**: App IDの Capability が、EASのビルドで付くかは、**未確認**（[release.md](release.md) の手順4）。

## 3. Google Play（Android）

文字数の上限は、Play Console の制限（アプリ名は30、簡単な説明は80、詳細な説明は4000）。

- **アプリ名**（6）: `わりかん生活`
- **簡単な説明**（37）: `同棲・夫婦・ルームシェアの生活費を、費目ごとの割合で月ごとにかんたん精算。`
- **詳細な説明**: App Store の説明（§2）と同じ文。
- **リリースノート（1.0.0）**: `初回リリース。`
- 簡単な説明に、価格・プロモーションを示す語（「無料」「割引」「ベスト」など）を入れない（Play Consoleの警告になりうる）。

### アプリのコンテンツの申告

- **広告**: 広告を含まない。
- **アプリのアクセス権（App access）**: ログインが必要な機能があるので、「制限付き」にして、手順（「Googleでログイン」を押し、審査用のアカウントを選ぶ）と、審査用のGoogleアカウント（A・B。上の「審査用アカウント」）のIDとパスワードを、この欄に入れる。Appleでのサインインは、Androidでは、WebのApple認証を経由するので、手順には書かない。
- **ターゲット ユーザー**: **決めること**: 13歳以上（子供向けではない。13歳未満を含めない）を第一案にする。金額を扱うが、実際の決済は無い。
- **コンテンツのレーティング（IARC）**: 暴力・性的な表現・不適切な言葉・薬物・ギャンブルなどは、すべて「なし」。ユーザー間のやり取り・ユーザー作成コンテンツ・位置情報の共有は、質問文を読んで答える（上の年齢指定と同じ。同じグループのメンバーにだけ見える）。
- **健康アプリの申告**: 健康に関する機能は無い（「健康に関する機能が一切ない」を選ぶ）。
- **金融機能の申告**: **決めること**（質問文を読んで）。このアプリは、金額の計算だけで、送金・決済・貸付・投資・暗号資産などを扱わない。
- **データ セーフティ**: 下の表（案）。

| データの種類 | 収集 | 共有 | 目的 | 任意か |
|---|---|---|---|---|
| 個人情報 > ユーザーID | する | しない | アプリの機能・アカウント管理 | 必須（ログインが必要） |
| 個人情報 > 名前（グループ内の表示名） | する | しない | アプリの機能・アカウント管理 | 必須（参加・作成のときに入力） |
| 金融情報 > その他の金融情報（支出・精算の金額） | する | しない | アプリの機能 | 必須（アプリの中心の機能） |
| アプリのアクティビティ > その他のユーザー作成コンテンツ（グループ名・費目名・支出の内容） | する | しない | アプリの機能 | 必須 |
| 個人情報 > 名前、メールアドレス（Googleのトークンの中身） | する（一時的に処理。保存しない） | しない | アカウント管理 | Googleでサインインしたときだけ |

- **「共有」の読み方**: 同じグループのメンバーに見えるのは、利用者自身の操作で共有するデータで、第三者への提供ではない、と読む。**Playの定義は、申告のときに確かめる**。Cloudflare（サーバー・データベース・メール転送）は、運営者の代わりに処理する事業者で、共有に数えない読み。これも定義で確かめる。
- **名前・メールアドレスの行（一時的な処理）**: Googleのトークン（`email`・`name`・`picture`）は、サーバーに届く。保存せず、`sub` だけを読む（ポリシーのとおり）。Playは、メモリの上だけで処理するデータも、回答に含めるよう求める場合がある。**現行のコンソールで、条件を確かめる**（Singfolioも同じ扱い）。Androidだけの申告で、iOSの表には入れない。
- データは、転送中に暗号化される（HTTPS。HTTPは拒否する）。
- **削除の手段**: アプリの中で、アカウントを削除できる（設定の「アカウントを削除」）。**Webの窓口は、案内だけ**（`https://warikan-seikatsu.app/privacy-policy#account-deletion`。サインインできない人は、同じAppleまたはGoogleのアカウントでサインインし直して削除する。運営者は、メールアドレスも名前も保存しないので、メールの依頼から、アカウントを引けない）。Playは、Webの窓口で、アプリを入れ直さずに、削除を依頼できることを求める。**この窓口が要件を満たすと読まれるかは、未確認**。「設ける」と申告する前に、実態どおりか確かめる。足りないと指摘されたときの案は、WBS 6.7 に書いた（Webでサインインして削除するページを置く、など）。
- **削除したあとに残るもの**（ポリシーに書いてある。申告にも、そのまま書く）: 他のメンバーがいるグループの、支出・締め・精算の記録は、表示名を「削除されたユーザー」に置き換えて残る。支出の内容として自由に入力した文字も、消さない。他のメンバーがいないグループは、グループごと削除する。
- **Googleのサインインの同意画面（Google Auth Platform）**: 公開状態を「本番環境」にする。アプリ名・サポートメール・ホームページ・プライバシーポリシーのURLが要る。基本のスコープ（`openid`・`email`・`profile`）だけなので、機密のスコープの検証は不要（Singfolioの調べによる）。未実施（[wbs.md](wbs.md) の6.6）。

## 4. スクリーンショット・フィーチャーグラフィック

作成済み（2026-11-26）。

- **フィーチャーグラフィック（Google Play）**: `assets/feature-graphic.png`（1024×500、透過なし）。赤地（`#C8000C`）に白で「わりかん生活」。**仮案**（plan.md 14章）。
- **アプリアイコン**: `assets/icon.png`（1024×1024、透過なし）。Playのストア用は `assets/play-store-icon-512.png`（512×512、`icon.png` を縮小）。
- **スクリーンショット**: 7枚。`assets/store-screenshots/` に、撮影画像（`raw/ja/` がiOSシミュレータの iPhone 18 Pro・1206×2622、`raw-android/ja/` がAndroidエミュレータ・1080×2424）と、見出しを合成した完成品（`ios/ja/` が1320×2868、`play/ja/` が1080×1920）がある。完成品を、ストアへ上げる。合成は `scripts/store-screenshots/compose.sh`（生成物は手で編集しない）。
  - 見出しは、このアプリの言葉で書いた（plan.md 14章の方針。他のアプリの文言を使わない）。背景は、赤（`#C8000C`。アイコンの地。白い文字が約5.9:1）と、淡いピンク（アクセント `#FC75A4` を白に約32%混ぜた派生色）を交互にした。白に近い中立色は、白いストアのページで画像の縁が消えるので使わない。書体は Noto Sans JP（OFL。`scripts/store-screenshots/fonts/`）。

| 番号 | 見出し | 補足 | 画面 |
|---|---|---|---|
| 01-home | iPhoneとAndroidの組み合わせでも使える。（**Playだけ**「AndroidとiPhoneの組み合わせでも使える。」） | 同じアプリで、記録も精算もいっしょに。 | ホーム（11月） |
| 02-shares | 家賃は7:3、食費は半分ずつ。 | 費目ごとに、負担割合を決めておけます。 | カテゴリと負担割合 |
| 03-cap | 外食費は月1万円まで、自分が負担。 | 上限を超えた分は、決めた割合で分担。 | カテゴリの編集（上限額） |
| 04-expense | 入力は、数タップでかんたん。 | 金額・日付・支払った人・費目を選ぶだけ。 | 支出の登録 |
| 05-breakdown | 負担額は、費目ごとに自動で計算。 | 支払額・負担額・差額が、ひと目で分かります。 | ホームの「内訳を見る」 |
| 06-settle | 精算は、今月でも、来月にまとめても。 | 送金ごとに、精算か繰越を選べます。 | ホーム（締めた10月。精算完了・繰越） |
| 07-recurring | 家賃は、毎月自動で登録。 | 固定費は、日付が来ると支出になります。 | 固定費の一覧 |

  - 1枚目の「iPhoneとAndroidでも」は、plan.md 14章の訴求の軸。Play の 9:16（下を切る）では、4枚目のキーパッドが写らない（見出しを「電卓つき」にしないのは、そのため。iOSの完成品は、キーパッドまで写る）。
  - **撮影用のデータは、すべて架空**（人名「あなた」「ゆうな」、品名、金額）。本番のWorkerには通信しない。**偽のサーバー**（`scripts/store-screenshots/fakeServer.js`）が、アプリの `fetch` とログイン状態を差し替える。応答の金額は、コードで計算する（合計・送金額が食い違わない。Nodeで、11月の合計148,090円・あなた99,085円・ゆうな49,005円・ゆうな→あなた16,845円になることを確かめた）。月の状態は、画面に出ない範囲で現実とずれている（`fakeServer.js` の先頭）。
  - **撮り直す手順**:
    1. `scripts/store-screenshots/fake-mode.sh on`（`package.json` の `main` を、偽の入口 `scripts/store-screenshots/entry.js` にする）。
    2. Androidは、`cd android && nice -n 10 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` で release の APK を作り、エミュレータ（`Filto_API_36`）に入れる。iOSは、`xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Release -sdk iphonesimulator -destination 'id=<UDID>' ONLY_ACTIVE_ARCH=YES build` で release の `.app` を作り、`xcrun simctl install` で入れる。**release で撮る**（debug は LogBox が写る）。
    3. ステータスバーを揃える。Android: `settings put global sysui_demo_allowed 1` のあと、`am broadcast -a com.android.systemui.demo -e command` に、`enter`・`clock -e hhmm 0941`・`battery -e level 100 -e plugged false`・`network -e wifi show -e level 4 -e fully true`・`network -e mobile hide`・`notifications -e visible false` を順に渡す（戻すときは `exit` と `settings delete global sysui_demo_allowed`）。iOS: `xcrun simctl status_bar <UDID> override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4 --operatorName ''`（戻すときは `clear`）。
    4. 画面を開いて撮る（`adb exec-out screencap -p`、`xcrun simctl io <UDID> screenshot`）。手順: ホーム（01）、設定 → カテゴリと負担割合（02）、外食の行（03）、「＋」で金額 `4280`・費目「食費」を選ぶ（04）、ホームで「内訳を見る」（05）、ホームの月の「＜」で10月（06）、設定 → 固定費（07）。
    5. `scripts/store-screenshots/compose.sh`（必要なら、画像の名前を引数に渡す）。
    6. **`scripts/store-screenshots/fake-mode.sh off` で戻す。** `src/appConfig.test.ts` が、`main` が `expo-router/entry` であることを `npm test` で確かめる（偽の入口のまま出荷しない）。
  - App Store は、1枚から10枚。JPEG・PNG、透過なし。iPhoneの必須サイズは、提出のとき App Store Connect で確かめる（1320×2868 だけで、小さい端末の枠が埋まるかも、そのとき）。Google Play は、スマートフォン用に2〜8枚（JPEG または 24ビットPNG。辺は320〜3840px。長辺は短辺の2倍まで。9:16 の 1080px 以上を4枚以上出すと、おすすめの掲載の対象になる）。

## 5. この内容が前提にしていること

- ログインが必須で、Appleまたは Googleのアカウント（`sub` だけを保存）で認証すること。
- 広告・アクセス解析・内課金が、まだ入っていないこと。入れるときは、掲載文・App プライバシー・データ セーフティ・年齢指定（広告の項目）・ポリシーを、先に直す。
- 画面が日本語だけであること。
- 5人までのグループ、通貨8種、費目・固定費・月締め・精算・繰越・脱退・アカウント削除が、実装済みであること（[wbs.md](wbs.md)）。
