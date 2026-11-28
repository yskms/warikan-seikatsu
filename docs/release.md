# ストア提出の手順と状態

ストア用のビルド・提出の手順。秘密情報（keystoreのパスワード、`.p8` など）は書かない。

## 状態（2026-11-26）

提出前の自動チェックのうち、**通っていない**のは `npm run release-check` の1件だけ。

- `worker/src/site.ts` の `ASSET_LINKS`（`assetlinks.json`）に、debug鍵のSHA-256が残っている。Play App Signing の鍵のSHA-256は、Play Consoleに最初のAABを上げるまで分からないので、**手順の6で置き換える**（置き換えるまで失敗するのが正しい動作）。

通っているもの: `npm run typecheck`、`npm test`（1113件）、Workerの `npm run typecheck`・`npm test`（862件）、`node scripts/generate-licenses.mjs --check`（142件）。

R8（下の「Android: R8」）を入れた release（`arm64-v8a`、debug署名）を、2026-11-26に確かめた。ビルドは通り（難読化の対応表 `mapping.txt` も出た）、Pixel 3に入れて起動してもJSが動き（端末はロック中で画面は見えない。logcatにクラッシュなし）、エミュレータ（`Filto_API_36`）では、ログイン画面が崩れず出て、「Googleでログイン」を押すとGoogleのアカウント選択（GMS の CredentialChooser）まで届き、クラッシュ・`ClassNotFound` は無かった。`node scripts/generate-licenses.mjs --check --apk <APK>` も通った（`.so` 22種、すべて把握しているもの）。**まだ確かめていないのは**、Play Consoleでの3つの率（AABを上げないと見えない）と、R8入りでログインを最後まで通すこと（手順の5・6で上げたあとに、内部テストの版で行う）。

**AndroidのAAB（2026-11-27）**: `nice -n 10 npx eas-cli@27.11.0 build --local --platform android --profile production --non-interactive --output warikan-seikatsu-1.0.0.aab` で作った（`--non-interactive` でも、アップロード鍵は、EASが作って保管した）。versionCode は 2（リモートの値が無く、ローカルの1から上げた）。ABIは4種（`arm64-v8a`・`armeabi-v7a`・`x86`・`x86_64`）、DEXは1つ（R8）、権限は `INTERNET`・`VIBRATE` だけ。`generate-licenses.mjs --check --apk` は通った（142件・`.so` 22種）。**アップロード鍵**（有効期限 2054-04-14）の証明書のフィンガープリント（公開してよい値。`keytool -printcert -jarfile <AAB>` で出る）:

- SHA-1: `1A:AA:DB:7F:1F:EC:DF:37:7D:02:14:C1:C5:F9:77:8B:B3:6E:72:4A`
- SHA-256: `77:7B:16:25:01:04:41:6A:3E:43:C3:6E:E0:BD:7A:DF:02:6F:FE:84:38:5F:51:FC:5A:F4:E2:28:B2:C2:F8:EF`

Play Consoleの「アプリの署名」で、アップロード鍵として、この値と同じかを見る。

**2回目のAAB（versionCode 3。参加の入口〔`/join-by-url`〕入り。2026-11-28）**: 同じコマンドで、`--output warikan-seikatsu-1.0.0-vc3.aab`。約13.5分（807秒）、65.1MB。アップロード鍵のSHA-1・SHA-256は、1回目と同じ（EASが保管する鍵を使った）。権限は `INTERNET`・`VIBRATE` だけ（`AD_ID` なし）、ABIは4種、DEXは1つ。`generate-licenses.mjs --check --apk` と `release-check` は通った。古いAAB（versionCode 2）は、内部テストへ上げたあとなので、削除した。

**Play App Signing の鍵（アプリ署名鍵。Playが署名し直す鍵）**: 内部テストの版（versionCode 2）を入れたPixel 3の `base.apk` の署名から読んだ（2026-11-28。発行者 `CN=Android, O=Google Inc.`。アップロード鍵とは別の鍵）。Play Consoleの「アプリの署名」の画面の「アプリ署名鍵」と一致するかを、見ておく。
- SHA-1: `82:41:CD:90:88:C8:89:3E:EF:97:A5:22:65:54:53:86:6B:BD:F1:E9`
- SHA-256: `C6:86:FE:32:31:74:85:EF:9F:0E:2D:ED:67:A1:3F:A1:67:DF:B3:0C:74:15:6E:A7:16:97:D0:7F:E3:07:E2:A1`

**端末から読む手順**（Playの画面を開かずに分かる）: `adb shell pm path com.yskms.warikanseikatsu` で `base.apk` の場所を出し、`adb pull` で取り、`~/Library/Android/sdk/build-tools/<版>/apksigner verify --print-certs --min-sdk-version 24 --max-sdk-version 36 base.apk` で読む。**`--max-sdk-version 36` が要る**（PlayのAPKには、Android 37 向けのハイブリッド署名〔ML-DSA〕も付き、JDKによっては、それが読めずに失敗する）。`keytool -printcert -jarfile` は使えない（v1の署名が無い）。`Source Stamp Signer` の値は、Playのスタンプで、アプリ署名鍵ではない。R8入りでログインを最後まで通すことは、内部テストの版で確かめる（手順の6のあと）。

アプリの版（`app.json` の `version`）は `1.0.0`。ビルド番号（iOSの `buildNumber`・Androidの `versionCode`）はEASが持つ（`eas.json` の `appVersionSource: "remote"`・`production` の `autoIncrement`）ので、`app.json` に書かない。

## ディスク

`eas build --local` は、一時ディレクトリへプロジェクトを展開し、依存の取得・ネイティブのビルドをそこで行う。完了すると消えるが、ビルド中は、Androidの全アーキテクチャ・iOSのarchiveそれぞれで数GBを使う。空きは15GB以上を目安にする（CLAUDE.md の全体方針）。

**実測（Android、2026-11-27）**: 全アーキテクチャのAAB（65.1MB）を、`nice -n 10` で作って、約12分（754秒。M4 MacBook Air）。空きは、ビルド前が約20.1GB、ビルド後が約18.6GB（差は約1.5GB。AABと、Gradle・Expoのキャッシュの増加を含む）。**ビルド中の最大値は測っていない**（前後の差だけ）ので、一時ディレクトリの最大使用量は、これより大きい。空きが15GBを切る見込みのときは、先に整理する。

**2回目の実測（2026-11-28）**: 空きは、ビルド前が約12.5GB（13,156,424KB）で、ビルド中の計測では、最低で約9.4GB（9,879,132KB。ビルドの途中の1回の計測。ピークではない）、終了後は、ビルド前とほぼ同じ（約12.5GB。一時ディレクトリは、完了で消える）。**ビルド中は、3.3GB以上を使う**。空きが13GB台でも、通った（目安の15GBを下回ったまま、ビルドした。ディスクが逼迫したときの整理の候補は、DerivedData〔約4.1GB。他のプロジェクトの分を含む〕と、使っていない版のGradleキャッシュ）。

## 手順

**EAS CLI の版: `27.11.0`**（**この1か所だけに書く**。上げるときは、ここを直す）。`eas` コマンドは、グローバルに入れず、版を固定して `npx eas-cli@27.11.0 <コマンド>` で呼ぶ（グローバルのインストールは、fnmでNodeの版を替えると消え、版も固定できない。retracks と同じ運用）。以下の手順の `<eas>` は、この `npx eas-cli@27.11.0` の意味。

1. **自動チェック**: `npm run typecheck`・`npm test`、`worker/` で `npm run typecheck`・`npm test`。
2. **EAS**: `<eas> login` のあと、`<eas> init`（`app.json` に `extra.eas.projectId` が入る。**整形（配列の改行）と、プラグインの展開結果 `extra.router` も書き込まれるので、`projectId` 以外は戻す**。済み: 2026-11-27、プロジェクト `@yskms/warikan-seikatsu`）。対話が要るので、手元の端末で行う。
3. **App Store Connect**: アプリを作る（バンドルID `com.yskms.warikanseikatsu`）。`eas.json` の `submit.production.ios.ascAppId` に、そのアプリのApple IDを入れる。
4. **iOS**: `<eas> build --platform ios --profile production --local` で `.ipa` を作り、`<eas> submit --platform ios --path <.ipa>` でTestFlightへ。Apple Developerの App ID に、Sign in with Apple と Associated Domains が付くか（EASが `app.json` から同期するか）は、**ビルドで確かめる**（未確認。docs/backend-design.md 9章の「公開のWebページ」）。
5. **Android**: `nice -n 10 <eas> build --local --platform android --profile production` で、全アーキテクチャのAABを作る（署名鍵〔アップロード鍵〕は、EASが初回のビルドで作って保管する）。Play Consoleでアプリを作り、AABを内部テストへ上げる。
6. **Play App Signing の鍵を、アプリの設定へ反映する**（Playから入れたアプリは、この鍵で署名し直される）。Play Consoleの「アプリの署名」（メニュー: 「Google Play による保護」→「Google Play ストアの保護」→「Play アプリ署名の管理」→「アプリの署名」。各項目は閉じていて、開かないとSHA-1が出ない。ページ下の Digital Asset Links の値はSHA-256で、SHA-1が要る用途には使えない）で、
   - SHA-256を、`worker/src/site.ts` の `ASSET_LINKS` に入れ、**debug鍵のSHA-256を外す**。`npm run deploy`（`worker/`）で本番へ出す（本番への操作なので、出す前に確認する）。そのあと `npm run release-check` が通ること。
   - SHA-1（アプリ署名鍵・アップロード鍵の両方）で、Google Cloudのプロジェクトに、リリース用のAndroidのクライアントを作る（コードには入れない。docs/backend-design.md 12章）。同意画面を「In production」にするのも、ここ。
7. **提出の直前**: `node scripts/generate-licenses.mjs --check --apk <AAB>`（ライセンスの一覧が今の依存と同じことと、把握していない `.so` が入っていないこと）。Play Consoleで、DEXコードの最適化（難読化・最適化・縮小の3つの率）と、権限の一覧が想定どおりかを見る。
8. **ビルド成果物の後片付け**: `.ipa`・`.aab`・`.apk` は、提出が済んだら消す（全体方針）。

## Android: R8

`plugins/withAndroidR8.js` で、releaseのR8（難読化・最適化・縮小）を有効にしている（CLAUDE.md。外さない）。R8の不具合はreleaseの実行時にしか出ないので、このpluginに触れたとき・RN / Expo / AGPを上げたときは、R8入りの release APK を起動して確かめる。
