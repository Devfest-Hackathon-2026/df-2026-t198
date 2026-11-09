# 模擬LMSを試す

架空の授業で、LMSの締切変更が学生・支援担当の画面に届く流れと、朝のメールの見本を試せる。Chrome拡張は不要。実際のGoogleカレンダーには書き込まず、メールも送らない。

## 手元で動かす

Node.js 26、pnpm 11、JDK 21以上が必要です。pnpmの固定版は [package.json](../package.json) の `packageManager` を参照してください。`node --version`・`pnpm --version`・`java -version` で確認できます。初回は依存とエミュレーターのダウンロードにネットワーク接続が必要です。Googleのアカウントやクラウドの設定は不要です。

repoのルートで準備します。

```sh
pnpm install --frozen-lockfile
pnpm build
```

8080・5177・8085・9099番ポートが空いている状態で、3つのターミナルをrepoのルートに開きます。エミュレーターの画面と制御には4000・4400・4500・9150番も使います。実際の使用ポートは、ターミナル1の起動時の一覧で確認してください。使用中なら、その作業が終わるのを待つか自分で起動したものだけを終了してください。

**ターミナル1：認証とデータ保存を起動**

```sh
pnpm exec firebase emulators:start --project demo-kadai-hisho --only auth,firestore
```

JavaがPATHにないmacOSでHomebrewのJDK 21を使う場合は、先に `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` を実行します。

**ターミナル2：架空のアカウントを用意してAPIを起動**

```sh
export GCLOUD_PROJECT=demo-kadai-hisho
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
read -s KADAI_DEMO_PASSWORD
export KADAI_DEMO_PASSWORD
node packages/server/scripts/seed-demo.mjs
unset KADAI_DEMO_PASSWORD
PUBLIC_WEB_ORIGIN=http://127.0.0.1:5177 node packages/server/dist/index.js
```

`read -s` の行で止まったら、8文字以上の手元用パスワードを入力しEnterを押します。入力は画面に出ません。ログインで使うので覚えておき、文書やログには残さないでください。初期設定の成功メッセージを確認してからAPIを起動します。既存のアカウントのパスワードや変更済みの締切は、初期設定をやり直しても戻りません。

**ターミナル3：APIの起動を確認して画面を起動**

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/api/health
```

`{"status":"ok"}` が返れば、APIがリクエストを受けられる状態です。接続できない場合は、ターミナル2でAPIが動いているか確認してください。起動を確認してから、同じターミナル3で画面を起動します。

```sh
VITE_USE_FIREBASE_EMULATORS=true pnpm --filter web exec vite --host 127.0.0.1 --port 5177 --strictPort
```

[手元の体験用LMS](http://127.0.0.1:5177/demo-lms) を開きます。学生は `trial-student@example.invalid`、支援担当は `trial-supporter@example.invalid` と、先ほど入力した共通の手元用パスワードでログインします。この文書の「手で試す」を実行してください。学生の画面は `/student`、面談画面は `/session` です。

終わったら各ターミナルでCtrl+Cを押して終了します。この手順ではエミュレーターのデータをファイルへ保存しないため、停止すると試した内容は失われます。

## 自動で操作を確かめる

前提は[手元で動かす](#手元で動かす)の実行環境。8080・5177・8085・9099番ポートが空いている状態で実行する。他の作業者のプロセスは終了しない。

```sh
pnpm test:demo:emulator
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm metrics:m6
```

`PLAYWRIGHT_MODULE` は手元にあるPlaywrightの入口。runnerが試験ごとにパスワードを生成してメモリだけで渡す。学生・支援担当を別のChromiumコンテキストで開き、先生役の操作、両画面の更新、応答を失った観測の再送、390px幅、ログアウトを確認する。M6の手順別結果は `m6.json`。失敗・未到達も分母に残す。画像と操作結果は `/tmp/kadai-i19-evidence/`（変更する場合は `ARTIFACT_EVIDENCE_DIR`）。この試験では認証の値や課題の通信本文を保存しない。

同じrunnerで、1画面ずつの表示・自動切り替え・タブでの中止・動きを減らす設定も確認する。`demo-live.browser.mjs --verify-local-demo` はrunnerがメモリで渡す架空の3組を使い、同じ反映と組の分離の判定を候補版とエミュレーターで行う。本番を確認する `--verify-live-demo` とは別の実行モードで、本番の配備確認には数えない。

## 手で試す

公開先では[体験用LMS](https://project-00439085-4e2d-44c3-9a8.web.app/demo-lms)の「学生として試す」、または説明資料で案内する個別の組を使う。手元では上の手順で用意した学生でログインする。

1. 「体験を最初からやり直す」を押し、確認で初期化する。同じ組をほかの人が使っている場合、その人の体験も戻る。
2. 「LMSを開く」を押す。LMSの読み取り後、約0.8秒で学生の画面に切り替わる。上のタブでLMS・学生・支援担当を選べる。
3. 画面上の「締切を1日延ばす」を押す。LMSの課題の詳細が開き、最初はLMS側だけが変わる。約3秒後に自動で読み取り、反映後に学生、その約2.5秒後に支援担当の画面を出す。途中でタブを押すと、その回の自動切り替えを止める。「自動で切り替える」を切った場合と動きを減らす設定では、押せる案内で画面を選ぶ。幅761px以上では「3つ並べて見る」で見比べられ、もう一度押すと1画面ずつに戻る。3つの画面は学生1人のログインで見る見本で、実際の共有先のログインとは別。
4. 「朝のメールを見る」を押す。今日の準備の見本を用意し、本文を表示する。「終わった」「後回し」は確認欄で日時と対象を確かめ、もう一度押すと予定を変更する。「終わった」は準備の記録で、LMSへの提出は別に行う。
5. 実際の面談画面も試す場合、別のブラウザか別のプロファイルで同じ組の支援担当としてログインし、「面談を開く」から学生を選ぶ。学生側では「学生の画面を開く」を使う。同じブラウザの別タブではログインする役割を分けられない。
6. 面談の「② 相談する」で準備の候補の「入れる」を押し、日時を確かめて保存する。学生側にも予定と登録者が出て、学生はどちらが入れた予定も外せる。「LMSを開く」を繰り返しても、締切の予定と変更の履歴が増えないことも確かめる。

「先生役の操作・メールの見本」を開き、「お知らせを出す」の後に「LMSを開く」を押すと、公式の締切を変えずに「要確認」が出る。お知らせ解析の利用枠を使い切った場合は案内が出る。操作に失敗したら接続と画面の案内を確かめ、同じ操作で再試行する。終わったら初期化し、各ブラウザでログアウトする。

やり直すと日付も今から試せるものになる。操作対象とAPIは [体験用データの契約](data-shapes.md#体験用データissue-19) を参照。

seedは台帳を直接作らない。既存の体験データは上書きせず、再実行で締切を戻さない。体験プロフィールと共有許可は設定する。実プロジェクトへの誤接続を拒否するため、この手順はエミュレーターでだけ動く。

## 説明資料の審査用リンク（Issue #241）

統合役は、開発用repoのルートで `node scripts/judge-links.mjs` を実行する。`fixtures-local/demo-accounts.local.json` の公開先 `origin` と `trial-1`〜`trial-3` の学生から、同じ順番のリンク3本を `fixtures-local/judge-links.local.txt` に権限600で保存する。既存の出力ファイルがある場合は上書きせず停止する。

リンクは `/demo-lms#judge=<base64url(JSON)>`。JSONは `email` と `password` だけで、暗号化ではない。説明資料で組ごとに渡し、repo・Issue・PR・ログ・紹介ページには載せない。画面は認証を始める前にfragmentを履歴から消し、別の人でログイン中ならログアウトしてからリンクの学生で入る。失敗時は空のログイン欄に戻る。共用の組は対象外。このIssueでは本物のリンクの生成やデプロイを行わない。

## 公開する担当者へ

Cloud Run・Hostingの反映は [deploy.md](deploy.md)。Issue #59では既存のFirestore規則の反映、メール／パスワード認証の有効化、`trial-1`〜`trial-3`の学生・支援担当の準備も許可されている。OAuthや新しい資源・APIの設定変更は含まない。

初回準備の入口は次のとおり。対象プロジェクトのApplication Default Credentialsが必要。固定プロジェクトと明示引数が一致しない、エミュレーターの設定が混在する、対象アカウント・プロフィール・認証情報ファイルがすでにある場合は停止する。エミュレーター用の上のseedは従来どおり実環境を拒否する。

```sh
node packages/server/scripts/seed-demo-live.mjs --project project-00439085-4e2d-44c3-9a8 --create-trial-accounts
```

乱数パスワードは `fixtures-local/demo-accounts.local.json` に権限600で排他的に保存してからアカウントを作る。途中で失敗した場合はファイルを消してやり直さず、対象6アカウントと文書の作成状態を確認する。既存データやパスワードを上書きする入口は用意していない。

公開先の確認は、作成した認証情報ファイルを使って次のコマンドで行う。先生役の操作で`trial-1`の架空の締切を1日延ばす。アカウントやパスワードの映らない画像と、秘密を含まない操作結果だけを `docs/records/2026-11-06-issue-59/` に残す。trace・HAR・通信本文は保存しない。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node packages/web/tests/demo-live.browser.mjs --verify-live-demo
```

公開先は [体験画面](https://project-00439085-4e2d-44c3-9a8.web.app/demo-lms)。認証情報は上のローカルファイルから各組へ別途渡し、repo・Issue・PRに載せない。学生と支援担当は別のブラウザ文脈で開く。3組は作成済みなのでseedを再実行せず、上の公開先試験で確認する。公開先の結果と残件は [Issue #59の再開後の記録](records/2026-11-06-issue-59-resumed.md)、権限不足で停止した時点の経緯は [初回の記録](records/2026-11-06-issue-59.md) を参照する。

アカウントとデータの対応は [data-shapes.mdの体験用データ](data-shapes.md#体験用データissue-19)。実環境では `demoAccounts/{uid}`、学生の `demo/current`、共有許可、面談日時を同じ組のUIDで用意する。パスワードをrepo・Issue・PRに書かない。ログイン後の支援担当は `/demo-lms` から `/session` に進めば同じ認証状態を使う。体験UIDから実カレンダーAPIへの接続・同期の操作はサーバー側でも拒否する。


## 説明資料なしで試す共用の体験（Issue #178）

共用の入口は `/demo-lms` のログイン欄の上にある「学生として試す」「支援担当として試す」。同時に見るときは別のブラウザか端末を使う。全員が同じ体験を使うので、必要なら「体験を最初からやり直す」を押す。審査の方は説明資料のアカウントを使う。入口が表示されない場合やログインできない場合は、説明資料のアカウント（審査用の組へのリンク）を使う。

お知らせの読み取りには、共用の組専用の事故止めの枠がある。回数制限は置かず、枠を使い切ると「今日の共用の体験では、お知らせの読み取りを使い切りました」と出る。審査用・通常の利用者の枠には影響せず、日本時間の日付が変われば再び使える。延長・やり直しは引き続き使え、やり直しても枠の消費は戻らない。両枠の額と予約・精算は [データの契約](data-shapes.md#お知らせの受信と要確認issue-45) を参照。

統合役が行う準備の入口 `--create-public-pair` とビルド時の4環境変数の渡し方は [共用の体験の準備](deploy.md#共用の体験の準備issue-178)。本番の準備・デプロイは実行前に人のOKを受ける。

ローカルでの確認は次のとおり。新しい乱数パスワードはメモリだけに置き、既存の認証情報ファイルを読まない。Auth・Firestoreエミュレーターと試験用の偽モデルで、役割ごとの入口・固定の失敗案内・延長→LMS→面談の更新・上限の文・やり直しを確認する。M6は従来の試験で別に測る。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm test:public-demo:browser
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm metrics:m6
```

## M6の手順

ローカルのAuth・FirestoreエミュレーターとChromium、および公開先で、次の8手順を固定して成否を記録する。画面の表示だけでなく、保存済み予定の日時・予定ID・反映済みの版を確かめる。ローカルと公開先は別々に集計し、実物のGoogleカレンダーの成績には混ぜない。

1. 学生と支援担当が別のブラウザでログインする。
2. LMSを開いて最初の課題を受け取る。
3. 先生役で締切を延ばし、LMSだけが変わる。
4. 学生がLMSを開き、新しい締切が台帳に入る。
5. 開いたままの学生画面が変わる。
6. 保存済みの体験用カレンダーの予定が動く。
7. 開いたままの面談画面が変わる。
8. 応答を失った再送でも履歴と予定が増えない。

公開先では、作成済みのアカウントを使って次のコマンドを実行する。作業ツリーから実行するときは、`KADAI_DEMO_ACCOUNTS_FILE`で許可された認証情報ファイルの場所を指定する（既定はrepo直下の`fixtures-local/demo-accounts.local.json`）。引数なしでは認証情報を読まず停止する。試験は`trial-1`の締切を1日延ばしたまま残すので、同時に同じ組を試さない。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node packages/web/tests/demo-m6-live.browser.mjs --verify-live-m6
```

結果は`docs/records/2026-11-06-issue-47-live/`に保存する。再実行する前に既存の記録を退避し、過去の結果を上書きしない。判定は既存のローカル試験と同じ8手順で、失敗・未到達も分母に残す。認証済み観測の受領記録と台帳を本人の権限で読み、C14の保存も照合する。認証情報・通信本文・trace・HARは記録しない。

公開先の実測と残る確認は [Issue #47の公開先記録](records/2026-11-06-issue-47-live.md)。初回のローカル実測は [以前の記録](records/2026-11-06-issue-47-verification.md) を参照する。


## 先生役のお知らせをローカルで試す（Issue #84）

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm test:demo-announcements:emulator
```

Auth・Firestoreエミュレーター、架空のアカウント、試験専用の偽Geminiだけを使う。先生役の「お知らせを出す」→「LMSを開く」で、学生・面談画面に要確認と日付の違いが出る。課題の欄の締切は変えない。再送・やり直し・再投稿も試験する。写真と結果は `/tmp/kadai-i84-evidence/`。公開先での有効化・実物のGeminiは含まない。


## 既存4組の体験を新しい初期データへ戻す（Issue #247）

統合役がコードの確認・取り込みと再デプロイを終え、本番のリセットを実行する合意があるときだけ行う。作業者は手順とスクリプトを用意するだけで、本番では実行しない。審査用3組と共用1組の体験の途中経過が消えるため、同時利用を避ける。

既存の管理者用Application Default Credentialsで実行する。認証情報の表示・再作成や権限の追加はしない。まずサーバーをビルドし、対象数を確認する。

```sh
pnpm --filter server... build
node packages/server/scripts/reset-demo-live.mjs --project project-00439085-4e2d-44c3-9a8 --dry-run
```

出力は `4` だけ。スクリプトはFirestoreの `demoAccounts` の印から `trial-1`・`trial-2`・`trial-3`・`public-1` の学生と支援担当の対応を確認する。共用は両方が `public: true`、審査用は共用の印なしであることも確認する。組が欠ける・対応が違う場合は、書き込む前に止まる。認証情報ファイルは読まない。エミュレーターの設定や異なるプロジェクトの指定があっても止まる。

実行の合意がある統合役だけが、次を実行する。

```sh
node packages/server/scripts/reset-demo-live.mjs --project project-00439085-4e2d-44c3-9a8 --reset-demo-pairs
```

画面の「体験を最初からやり直す」と同じ `createDemoStore().reset(uid, false)` を4回呼ぶ。消える状態・残す共有許可は [体験用データのリセット契約](data-shapes.md#体験用データissue-19) と同じ。アカウント・パスワードや共有許可は変更しない。実物カレンダーへの接続がある場合は既存の処理が拒む。完了ごとに件数だけを表示し、メール・パスワード・SDKの例外内容は出力しない。

4組全体では1つのトランザクションではない。途中で失敗したら後の組へ進まず停止し、すでに完了した件数が残る。状態を確認してから再試行する。最後に学生と支援担当でログインし、LMSを開いて新しい名前の台帳・体験用カレンダーを作り、同じ課題を両画面で確認する。リセット自体はLMSの観測や予定を先に作らない。
