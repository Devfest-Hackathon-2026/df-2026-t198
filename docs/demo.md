# 模擬LMSを手元で試す

`/demo-lms` から学生・支援担当の体験用アカウントでログインする。学生は授業と課題を見て「LMSを開く」を押し、学生の時間割と支援担当の面談画面を更新する。先生役のボタンはLMSの締切だけを1日延ばし、「LMSを開く」までは時間割・面談画面の締切を変えない。カレンダーはこの経路にまだ接続していない。

## 自動で操作を確かめる

前提は[READMEの実行環境](../README.md)。8080・5177・8085・9099番ポートが空いている状態で実行する。他の作業者のプロセスは終了しない。

```sh
pnpm build
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm exec firebase emulators:exec --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs"
```

`PLAYWRIGHT_MODULE` は手元にあるPlaywrightの入口。runnerが試験ごとにパスワードを生成してメモリだけで渡す。学生・支援担当を別のChromiumコンテキストで開き、先生役の操作、両画面の更新、応答を失った観測の再送、390px幅、ログアウトを確認する。画像と操作結果は `/tmp/kadai-i19-evidence/`（変更する場合は `ARTIFACT_EVIDENCE_DIR`）。この試験では認証の値や課題の通信本文を保存しない。

## 手で試す

3つのターミナルを使う。

1. `pnpm build` の後、`PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" pnpm exec firebase emulators:start --project demo-kadai-hisho --only auth,firestore`。
2. 同じターミナル内で `GCLOUD_PROJECT=demo-kadai-hisho`、`FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`、`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` をexportする。`read -s KADAI_DEMO_PASSWORD` で8文字以上の試験用パスワードを入力してexportし、`node packages/server/scripts/seed-demo.mjs`。その後 `node packages/server/dist/index.js`。
3. `VITE_USE_FIREBASE_EMULATORS=true pnpm --filter web exec vite --host 127.0.0.1 --port 5177 --strictPort`。

学生は `http://127.0.0.1:5177/demo-lms` に `trial-student@example.invalid` でログインし、上で入力した試験用パスワードを使う。支援担当は別のブラウザで同じURLに `trial-supporter@example.invalid` と同じパスワードでログインし、「面談を開く」から学生を選ぶ。学生の「LMSを開く」で最初の課題が並ぶ。先生役で締切を延ばし、もう一度「LMSを開く」で時間割・開いた課題・面談が変わる。

seedは台帳を直接作らない。既存の体験データは上書きせず、再実行で締切を戻さない。体験プロフィールと共有許可は設定する。実プロジェクトへの誤接続を拒否するため、この手順はエミュレーターでだけ動く。

## 公開する担当者へ

Cloud Run・Hosting・Firestore規則の反映はIssue #18側の手順で行う。このIssueではデプロイと実環境のアカウント作成を行っていない。メール／パスワード認証が利用可能であることと、試す人ごとの学生・支援担当アカウントの用意を、実環境の作成権限を持つ人が確認する必要がある。

アカウントとデータの対応は [data-shapes.mdの体験用データ](data-shapes.md#体験用データissue-19)。実環境では `demoAccounts/{uid}`、学生の `demo/current`、共有許可、面談日時を同じ組のUIDで用意する。パスワードをrepo・Issue・PRに書かない。ログイン後の支援担当は `/demo-lms` から `/session` に進めば同じ認証状態を使う。体験UIDへの実カレンダー接続は将来の接続APIでも拒否する必要がある。
