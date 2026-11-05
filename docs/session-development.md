# 面談画面のローカル確認

架空のアカウント・授業・課題だけを使う。公開先・本物のFirebaseプロジェクトへの配備はこの手順に含まない。データと権限の契約は [data-shapes.md](data-shapes.md#面談日時と担当する学生issue-21)。

## 自動試験

```sh
pnpm test:sessions:emulator
```

JDK 21以上が必要。既存のAuth（9099）・Firestore（8085）のエミュレーターを止めてから実行する。`demo-kadai-hisho` で実際のAPI・Firestore規則・Webの購読を確認し、終了時に停止する。通常の `pnpm test` ではこの2試験をskipする。

## 画面を開く

1. ルートで `pnpm --filter server... build` を実行する。
2. 1つめのターミナルで `pnpm emulators` を起動する（JDKのbinをPATHに置く）。
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
VITE_FIREBASE_CONFIG='{"projectId":"demo-kadai-hisho","apiKey":"emulator-only","authDomain":"demo-kadai-hisho.firebaseapp.com"}' \
VITE_USE_EMULATORS=true pnpm --filter web dev
```

表示されたURLの `/session` を開き、`demo-supporter@example.invalid` と、手順3で決めたパスワードでログインする。

## 確かめる操作

- 学生 `demo-student-a` を選び、「次の面談までの締切」「前回の面談からの変化」「今日決めること」を見る。数学レポートの要確認には理由の1文が付く。
- 学生 `demo-student-b` に切り替えると、物理演習が出て数学レポートは消える。
- 「面談日時を変える」から次の面談を課題の締切より前にして保存すると、締切の一覧から課題が外れる。空欄にすると期間を推測せず、日時の入力を促す。
- 管理画面 `http://127.0.0.1:4000/firestore` で、選択中の `students/demo-student-a/supporters/demo-supporter` の `revokedAt` を日時の文字列に変える。開いている面談の全内容が消え、日時保存も拒否される。一覧の「一覧を更新」でも学生が消える。
- ログアウトすると学生の選択肢と内容が消える。学生アカウント（`demo-student-a@example.invalid`、同じ手元用パスワード）では「自分の面談を見る」で読む。面談日時の編集は出ない。

## 実環境につなぐ場合

ビルド時に同じ `VITE_FIREBASE_CONFIG` に公開用のFirebase Web設定を与え、`VITE_USE_EMULATORS` は付けない。WebはGoogleログインを使う。APIの `/api` は同じoriginに配信する必要がある。HostingからCloud Runへの転送、認証プロバイダー・許可ドメイン・試す人のアカウントの配備は別途設定する。このIssueでは作成・変更しない。
