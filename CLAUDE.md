# わりかん生活

同棲カップル・夫婦などの共同生活費を記録し、カテゴリごとの負担割合で月ごとに精算するアプリ（iOS / Android）。

- 仕様の正本: [docs/plan.md](docs/plan.md)（企画メモ）
- データ・API・競合制御: [docs/backend-design.md](docs/backend-design.md)
- 画面: [docs/screens.md](docs/screens.md)

## 構成

- アプリ名は「わりかん生活」（旧名「同棲折半」）。識別子（`slug`・`scheme`・Workerの名前・D1のデータベース名・npmのパッケージ名・GitHubのリポジトリ名・フォルダ名）は、そのローマ字の `warikan-seikatsu`。bundle ID・`package` は `com.yskms.warikanseikatsu` で、公開後は変えられない（`src/appConfig.test.ts`）。
- リポジトリのルートがExpoアプリ（Expo Router）。`app/` は画面（ルート）のディレクトリで、アプリ全体のフォルダではない。
- `worker/` は、Cloudflare Workers + D1 のバックエンド。自前の `package.json`・ロックファイル・tsconfigを持つ独立したパッケージ。
- `src/` はNodeのテスト（`npm test`）から直接実行するため、画面（RN・Expoのimport）を置かない。RN・Expoに触れる接続（ブラウザ・Linking・AppStateなど）は `platform/` に置き、`src/` のRepositoryにはインターフェースを渡して注入する。画面をまたいで使うReactの部品・フック（`AuthStateProvider` など）は `ui/` に置く（`app/` の中に置くと、画面（ルート）になる）。

## 変えてはいけないもの（Singfolioと同じ理由）

- **npm workspacesにしない。** ルートのExpo / RNの依存の固定が、hoistingで崩れうる。
- **ルートの `tsconfig.json` は `worker/` を除外したまま。** Workerは独自のtsconfig（workerdの型）で型チェックする。
- **アプリとWorkerでコードを共有しない。** リクエスト・レスポンスの形は docs を正として、両側に書く。負担・精算の計算はWorkerだけが持ち、アプリには `summary` API の結果を表示させる（ホームの精算見込みも同じ）。
- 認証はSingfolio（`~/Developer/singfolio/worker`）からのコピー。コピー元のコミットをコードコメントに書き、Singfolio側の修正は手で取り込む（docs/backend-design.md 1章）。コピーしたファイル（`worker/src/` の `nonce.ts`・`idToken.ts`・`identity.ts`・`login.ts`・`auth.ts`・`session.ts`・`deleteAccount.ts`・`appleToken.ts`・`appleClientSecret.ts`・`appleWeb.ts`・`appleNotification.ts` など）は、構造・名前を保つ（整理・分割をしない。差分を取り込めなくなる）。このアプリで変えたところは、各ファイルの先頭のコメントに書いてある。アプリ側のコピー（`src/repositories/` の `apiClient.ts`・`authRepository.ts`・`sessionRepository.ts`・`authError.ts`・`appleWebSignInRepository.ts`・`appleSignInRepository.ts`、`src/services/base64url.ts`、`src/domain/types.ts`）も同じ。`src/services/accountService.ts` は、Singfolioの同名のファイルを元に、このアプリ向けに変えたもの（先頭のコメントに、変えたところを書いてある）。`platform/` の `authBrowser.ts`・`authCrypto.ts`・`secureStorage.ts` は、Singfolioの `src/services/index.ts` の一部を元にしたもので、ファイル単位のコピーではない（差分を取り込むときの目印として、コピー元のコミットをコメントに書いてある）。`sessionRepository` に、Singfolioにある `localDataId` を「揃えて」足さない（このアプリには、結びつけるローカルDBが無い。理由は先頭のコメント）。
- **サインインの層の再インストール対策（`src/services/accountService.ts` の `InstallMarker`）は、印を先に置いてから前のセッションを捨てる。順序を逆にしない**（印を置けない端末が、起動のたびにログアウトされる）。印の実体（`platform/installMarker.ts`。Documentsのファイル）を、Keychain（セッションと一緒に残り、意味がなくなる）やcache（OSが消す）へ移さない。印は最初のリリースから置いておく（後から足すと、その版の最初の起動で、全員がログアウトされる）。保存先を読めない値（`unreadable`）は、「サインインしていない」と同じに扱わない（`storage-failed`。9章の「サインインの層」）。
- **認証が要るAPIの呼び出しは、必ず `platform/accountService.ts` の `sessionAccess.withSession` を通す。** 端末のセッションが無くなったこと（401・ログアウト・アカウントの削除）を画面のログイン状態へ伝えるのは、この包みだけ（`src/services/sessionLost.ts`）。通さない呼び出しや、ログアウト側（セッションが無くなったこと）を画面から `AuthStateProvider` の状態へ直接反映する実装は、ログインしていないのにメインの画面が出続ける原因になる。ログイン済みにする側は別で、ログイン画面が `signIn` の成功で `markSignedIn` を呼ぶ（外さない。包みにも寄せない）。`accountService` 自体には通知を足さない（Singfolioのコピーの差分を取り込めなくなる）。
- **`expo-secure-store` の config plugin を `app.json` に足さない。** `npx expo install expo-secure-store` は自動で足すので、足されていたら外す。足すと、Androidのバックアップ規則が `<include domain="sharedpref">` になり、将来、端末に置くデータ（ローカルDBなど）がバックアップから外れる。iOSには、使っていないFace IDの文言も足される。plugin のオプション（`configureAndroidBackup: false`・`faceIDPermission: false`）で、この2つは止められるが（plugin のソースで確認。ビルドでは未確認）、止めると何もしないので、足す理由が無い。`requireAuthentication` など、Face IDの文言が要る機能を使うときに見直す（docs/backend-design.md 9章の「アプリ側の認証の土台」）。
- **AndroidのAppleログインのアプリ側。** `app/+native-intent.tsx` は外さない（戻りのURL `warikan-seikatsu://auth/apple?...` を expo-router に渡すと「画面が見つかりません」へ遷移する。起動時のURLには `null` ではなく `'/'` を返す: `null` だと、ルートから始める処理が飛ぶ）。`platform/authBrowser.ts` の `openBrowserAsync` のオプション（`createTask`・`useProxyActivity`・`showInRecents`）は、既定と同じ値を明示して固定している。外さない（旧来の経路は、アプリの外へ移ると Custom Tab を破棄し、SMSの確認コードを別のアプリで開く経路が壊れる）。`openAuthSessionAsync` は使わない。
- **`expo-font` は、コードで使っていないが、SDKに合った版で直接の依存に固定している。外さない。** 外すと、`@expo/vector-icons` のpeer（`expo-font >=14.0.4`）の指定から、SDK 58用の版がhoistされ、Androidのネイティブビルドが Gradle の設定段階（autolinking の `publication` に `version` が無い）で失敗する。SDKを上げるときは、`npx expo install --fix` で一緒に上げる。

## 設計上の注意（docs に詳細）

- D1の書き込みは、`expense_groups.data_version` と `write_token` の楽観ロックで行う。1つのグループへの書き込みは `worker/src/groupWrite.ts` の `writeToGroup` を通す（読み直して1回やり直す操作は `writeToGroupWithRetry`。検証用の読み込みは、渡す `plan` の中だけで行う）。後続の文の条件を `data_version = v+1` に「簡略化」しない。バージョンは、検証・計算に使うデータより**先に**読む。失敗理由の扱い、複数グループにまたがる書き込みの未決事項は、docs/backend-design.md 8章・12章。
- 月の集計・精算額は `worker/src/monthState.ts` の `computeMonthFromState` だけが計算し、summary（締める前の見込み）と月締めの両方がこれを使う。別々に計算すると、締めた結果が見込みとずれる。月締めの書き込みは、文の数が行数に比例して増えないよう `insertRowsGuarded` で複数行を1文にまとめている（文の数は費目×メンバーの数でゆるやかに増える。検査は `worker/test/closings.test.ts` の「D1のクエリ数」）。行ごとのINSERTに「簡略化」しない。D1のクエリ数の上限（Freeは1回の呼び出しにつき50）は、公式は batch を1回と数えると書くが、本番のFreeで確かめるまでは、batch の1文も1クエリとして数えて見積もる（コード・テスト・docsの「クエリ数」「予算」は、その数え方。docs/backend-design.md 8章の「D1のクエリ数の数え方」）。
- 脱退済み（`left`）への遷移は `worker/src/closedMonth.ts` の `markLeftStatement` だけが行い、月締め・精算（とCron）が使う。繰越済み（`carried`）の送金は、繰越先の月を締めるまで未処理と同じに扱う。「繰越は処理済み」と見て条件を外さない（繰り越した額は翌月の締めまでどの送金にも入っておらず、`left` にすると本人が精算できない）。同じ理由で、脱退月より後の未締めの月の支出に本人が関わっているあいだも `left` にしない。脱退月が飛ばされた月のときは、脱退月より後の月が締められていれば、脱退月が締められたものとして扱う（`>=` を `=` に戻さない。docs/backend-design.md 5章の4）。
- 脱退の確定（`leaving` にし、翌月の割合のリセット・招待の取り消し・固定費の停止を行う）は `worker/src/membership.ts` の `confirmLeaveStatements` だけが行い、月締め・脱退を選ぶ操作・月初のCron（`worker/src/cron.ts`）が使う。経路ごとに書き写さない（確定の中身がずれる）。APIは、脱退月が終わったメンバーを、Cronの確定の前でも確定したものとして扱う（`access.ts` の `isLeaveEffective`）。最後の1人の脱退は、確定のときにグループごと消す（docs/backend-design.md 5章）。
- アカウント削除のAPI（`worker/src/deleteAccount.ts`。Singfolioのコピー）の `deleteAccount` は再認証の手順で、データ処理の `accountDeletion.ts` の `deleteAccount` とは別のもの（同名のまま。統合・改名しない。コピーの差分を取り込めなくなる）。順序は、外部への待ち（iOSの認可コードの交換）をD1を消す前に済ませ、Appleのトークンの失効だけを消したあとに行う。失効の失敗で削除を止めない（`appleRevoked: false` で伝える）。この順序を入れ替えない（docs/backend-design.md 9章の「認証API」）。
- 複数のグループにまたがる書き込み（アカウント削除。`worker/src/accountDeletion.ts`）は `writeToGroups` を通す。バージョンを上げる文は、全グループで1文のまま。グループごとのUPDATEに分けると、一部のグループだけ書き込まれる。`accountDeletion.ts` が渡している追加条件（読んだあとに別のグループへ参加されたことの検出）も外さない。`expense_groups` の行を消す文は、ほかの文の最後にまとめる（docs/backend-design.md 8章）。
- 費目を作るときは、最初の未締めの月だけでなく、それより後で割合の行がある月すべてに、その月のメンバーでの均等な行を書く（`worker/src/categories.ts`）。最初の月だけに「簡略化」しない（後の月が、脱退・削除したメンバーを含む割合を引き継ぐ）。逆に、割合を直す `PUT` は、後の月の行を書き換えない（メンバーの増減で書いた行を上書きしない。`overriddenMonths` で知らせる。docs/backend-design.md 9章）。
- 固定費の自動登録（`worker/src/recurringRun.ts`）は、最初の検索の結果を書き込みに使わない。グループごとに、バージョンを読んだ**あとで**固定費・メンバー・締めた月を読み直す（古い金額や停止前の状態で支出を作らない）。`runScheduled` では、脱退の確定（固定費の停止を含む）のあとに呼ぶので、順番を逆にしない。アーカイブした費目の固定費は、`paused_at` で止めず、作るのだけを見送る（`paused_reason` に費目の理由を足さない。状態から導けて、費目を戻せば自動で作られる）。一度でも支出を作った固定費は物理削除しない（支出と生成記録が参照する。作っていないものだけ `DELETE` できる。「作った」かは生成記録の `expense_id` の有無で見る。`NULL` の「作らなかった」記録は数えず、削除のときに一緒に消す。数えると、月の途中で登録した固定費が消せない）。固定費を登録・再開して、新しく今月の予定日を過ぎた状態にする書き込みは、今月の分を「作らなかった」生成記録（`expense_id` が `NULL`）で残す。残さないと、すぐに今月の分が作られ、手で入力した分と二重になる。ただし、アーカイブした費目のせいで見送られていた固定費は、費目を戻しても選び直しても、この記録を残さない（もともと作る予定だったものを、次の回に作る）。書く文の数は固定費 × メンバーで増えるので、自動登録は、読んだあとに文の数を数え、予算に収まる件数だけ作る。詳細は docs/backend-design.md 7章・9章。
- グループ内のデータを扱うAPIは、認証・所属・月の閲覧範囲の判定を `worker/src/access.ts` で行う。他のグループのID、メンバーでない人、脱退済みの人は、区別せず404にする（IDの存在を教えない）。
- グループの配下のテーブルには、必ず `group_id` が先頭の主キーか索引を持たせる。無いと、グループの削除や親の行の削除で、全グループの行を読む（D1は読んだ行数で課金。付録Aの冒頭）。
- 繰越は、翌月の締めでメンバーごとの差額に合算して、送金を作り直す。翌月の支出の総額・負担額には入れない（docs/plan.md 6章）。
- アプリが、書き込み（`POST`・`PATCH`・`DELETE`）の応答を読むときは、使う項目だけを検べる。全項目を検べる書き方に「そろえない」。応答の形が少しずれただけで失敗にすると、サーバーでは済んでいる操作が画面では失敗に見え、同じ `id` で再送しても同じ失敗を繰り返す（`src/repositories/groupRepository.ts` の `create` は `id` だけを読む。`id` を読むのは、JSONでない200（宿のWi-Fiの認証画面など）を、成功と取り違えないための最低限の確認）。読み込み（`GET`）は、全項目を検べてよい。ただし、**表示にしか使わない列挙値**（月の一覧の `status`、`close.reason`、支出の `splitMethod`、メンバー・所属の `status`）は、知らない値を許す（`parse.ts` の `oneOfOrUnknown`。サーバーが値を足したとき、古い版のホームが全部失敗し、画面が「通信環境が原因」と案内してしまうため）。操作の可否に関わる値（送金の `status`・`canCarry`）は、厳密に検べる。メンバー・所属の `status` は、いまは判断に使っていないので許している（入口の一覧が全部失敗するのを避けるため）。**この値で出し分ける画面（メンバー一覧、脱退など）を作るときは、`'unknown'` の扱いを、その画面で決める**。**Singfolioのコピー（上の「変えてはいけないもの」の一覧。`authRepository.ts` など）は対象外**で、構造を保つ（この規則を理由に直さない）。
- **支出のシート（`ui/expense/ExpenseSheet.tsx`。入力の規則は `src/services/expenseForm.ts`）**: 登録できる月はアプリで計算せず、月の一覧の `open` を使う。割合・均等の負担額のプレビューは出さない（端数の配り方をアプリに書き写すことになる。docs/screens.md 4章に元のプレビュー案があるが、作っていない。足さない）。ホームの一覧（`expenseRepository.list`）は `allocations` を読まず、編集のシートだけが `get` で読む（1つにまとめない。ホームが、読まない項目の崩れで全部失敗しなくなる）。編集は、変えた項目だけを送る（全項目を送り直すと、保存された負担額に触れる）。登録の `id` は、最初に保存を押したときに1回だけ作り、やり直しでも使い回す（作り直すと、結果が分からない失敗のあとで、支出が2件になる）。
- **Androidのキーボード避け**: アプリは edge-to-edge なので、`adjustResize` を指定しても、キーボードでウィンドウが小さくならない。入力欄・下端のボタンのある画面は、`KeyboardAvoidingView` に `behavior="padding"` を、Androidでも指定する（支出のシートで、保存ボタンが隠れることを確かめた）。`app/create-group.tsx` も同じ理由で `padding` にした（下端の「作成」が、キーボードの下に隠れていた）。新しく入力欄のある画面を作るときも同じ。
- 金額は通貨の最小単位の整数、割合は1万分率の整数。浮動小数点で持たない。

## コマンド

- アプリ: `npm run typecheck`、`npm test`
- Worker（`worker/` で実行）: `npm run typecheck`、`npm test`（ルートの `npm test` には含まれない）
