# 面談画面のローカル確認

架空のアカウント・授業・課題だけを使う。公開先・本物のFirebaseプロジェクトへの配備はこの手順に含まない。データと権限の契約は [data-shapes.md](data-shapes.md#面談日時と担当する学生issue-21)。

## 自動試験

```sh
pnpm test:sessions:emulator
```

JDK 21以上が必要。既存のAuth（9099）・Firestore（8085）のエミュレーターを止めてから実行する。`demo-kadai-hisho` で実際のAPI・Firestore規則・Webの購読を確認し、終了時に停止する。通常の `pnpm test` ではこの2試験をskipする。

## 画面を開く

1. ルートで `pnpm --filter server... build` を実行する。
2. 1つめのターミナルで `pnpm exec firebase emulators:start --project demo-kadai-hisho --only auth,firestore` を起動する（JDKのbinをPATHに置く）。
3. 別のターミナルで、手元用のパスワードを決めて架空データを入れる。

```sh
GCLOUD_PROJECT=demo-kadai-hisho \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
SESSION_DEMO_PASSWORD='<8文字以上の手元用パスワード>' \
node packages/server/scripts/seed-session.mjs
```

この補助は上記のローカル接続先とdemoプロジェクト以外では停止する。ログイン情報やトークンは出力しない。学生2人の台帳・面談日時・共有の許可を入れる。再実行は共有を許可し直し、面談日時と架空の課題を更新するため、この確認専用のエミュレーターで使う。

4. APIを起動する。

```sh
GCLOUD_PROJECT=demo-kadai-hisho \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
pnpm --filter server start
```

5. 別のターミナルでWebを起動する。Viteの `/api` はローカルの8080番へ転送する。

```sh
VITE_USE_FIREBASE_EMULATORS=true pnpm --filter web dev --port 5177 --strictPort
```

表示されたURLの `/session` を開き、`demo-supporter@example.invalid` と、手順3で決めたパスワードでログインする。

## 確かめる操作

- 学生 `demo-student-a` を選ぶと `/session/demo-student-a` の「確かめる」が開く。変化と締切を見て、要確認の印と理由を確かめる。課題の行を押すとLMSへのリンク・書いてあったこと・これまでの変更が開く。時間割はこの画面には出ない。
- 「② 相談する」か末尾のリンクで `/session/demo-student-a/plan` に移り、時間割・準備の候補・今日決めることを見る。締切一覧の全文は出ない。「① 確かめる」とブラウザの戻るでも戻れる。確認の依頼は準備中で、ボタンは無効。学生への送信・予定の保存は行わない。
- 学生を変えるときは「学生を選び直す」で一覧に戻る。共有の案内はこの一覧だけに出る。
- 学生 `demo-student-b` に切り替えると、物理演習が出て数学レポートは消える。
- 「面談日時を変える」から次の面談を課題の締切より前にして保存すると、締切の一覧から課題が外れる。空欄にすると期間を推測せず、日時の入力を促す。
- 管理画面 `http://127.0.0.1:4000/firestore` で、選択中の `students/demo-student-a/supporters/demo-supporter` の `revokedAt` を日時の文字列に変える。開いている面談の全内容が消え、日時保存も拒否される。一覧は30秒ごとに自動で更新する。画面を再読み込みしても、取消した学生が消える。
- ログアウトすると学生の選択肢と内容が消える。担当学生がいない場合だけ「自分の面談を見る」が出る。学生アカウント（`demo-student-a@example.invalid`、同じ手元用パスワード）では、このリンクで読む。面談日時の編集は出ない。

## ブラウザ試験

手元のPlaywrightを使う（workspaceの依存には追加しない）。上のAPIとViteを起動したまま、手動で起動したAuth・Firestoreだけを止め、次を実行する。`PLAYWRIGHT_MODULE` は手元のPlaywrightの `index.mjs` の絶対パス。試験専用のエミュレーターに架空データを入れ、終了後に停止する。

```sh
GCLOUD_PROJECT=demo-kadai-hisho \
SESSION_DEMO_PASSWORD='<8文字以上の手元用パスワード>' \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" \
pnpm exec firebase emulators:exec --project demo-kadai-hisho --only auth,firestore \
"node packages/server/scripts/seed-session.mjs && node packages/web/tests/session.browser.mjs"
```

2画面の要素分離・行の展開・段階のリンクとブラウザの戻る・直接URL・候補の表示と未保存・日時変更と未設定・課題の即時更新・390px幅・共有取消・ログイン共有・ログアウトを確認する。操作の結果とスクリーンショットは、既定で `/tmp/kadai-i39-evidence/`。`ARTIFACT_EVIDENCE_DIR` で変えられる。通常の `pnpm test` には含めない。

## 実環境につなぐ場合

学生の画面と同じFirebase接続・ログインを使う。公開用のビルド設定は [READMEの画面](../README.md#画面) を参照し、エミュレーターの指定は付けない。APIの `/api` は同じoriginに配信する必要がある。HostingからCloud Runへの転送、認証プロバイダー・許可ドメイン・試す人のアカウントの配備は別途設定する。このIssueでは作成・変更しない。

ブラウザ試験は開始時刻に時計を固定し、6日後の架空の締切に対する2候補を確認する。曜日や締切日の境界は固定日付の単体試験で確認する。手動の見本では締切までの平日がないと候補が出ない。
