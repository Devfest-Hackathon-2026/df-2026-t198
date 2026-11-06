# 模擬LMSを試す

`/demo-lms` から学生・支援担当の体験用アカウントでログインする。学生は授業と課題を見て「LMSを開く」を押し、学生の時間割と支援担当の面談画面を更新する。先生役のボタンはLMSの締切だけを1日延ばし、「LMSを開く」までは時間割・面談画面の締切を変えない。学生の画面の「締切のカレンダー」も更新する。ここに並ぶのは模擬の書き込み先に保存した予定で、Googleカレンダーには書き込まない。

## 自動で操作を確かめる

前提は[READMEの実行環境](../README.md)。8080・5177・8085・9099番ポートが空いている状態で実行する。他の作業者のプロセスは終了しない。

```sh
pnpm test:demo:emulator
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm metrics:m6
```

`PLAYWRIGHT_MODULE` は手元にあるPlaywrightの入口。runnerが試験ごとにパスワードを生成してメモリだけで渡す。学生・支援担当を別のChromiumコンテキストで開き、先生役の操作、両画面の更新、応答を失った観測の再送、390px幅、ログアウトを確認する。M6の手順別結果は `m6.json`。失敗・未到達も分母に残す。画像と操作結果は `/tmp/kadai-i19-evidence/`（変更する場合は `ARTIFACT_EVIDENCE_DIR`）。この試験では認証の値や課題の通信本文を保存しない。

## 手で試す

[READMEの「手元で動かす」](../README.md#手元で動かす) に環境の準備・起動・ログインをまとめている。起動後は [「ブラウザで試す」](../README.md#ブラウザで試す) の1〜6を行う。

学生は「体験を最初からやり直す」で、自分の組を最初の「LMSを開く」前に戻せる。日付も今から試せるものになる。初めて開いた際に締切や面談が古くなっている場合も更新する。操作対象とAPIは [体験用データの契約](data-shapes.md#体験用データissue-19) を参照。

seedは台帳を直接作らない。既存の体験データは上書きせず、再実行で締切を戻さない。体験プロフィールと共有許可は設定する。実プロジェクトへの誤接続を拒否するため、この手順はエミュレーターでだけ動く。

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
