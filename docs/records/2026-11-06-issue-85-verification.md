# 実演用の支援担当の準備（Issue #85）

## 目的と範囲

Soraが実物の経路を実演する際、実学生の面談画面を別のブラウザで開けるようにする。根拠はIssue #85の明示の許可。既存のAuth・共有許可・面談日時の形を使い、製品画面、API、Firestore規則、依存、IAM、OAuth、Cloudリソースは変更しない。課題の内容は読み取らず、記録しない。

作業前の計画は、明示の引数→Googleログイン利用者の全ページから体験用を除外→候補が1人であること→既存の利用者・文書・秘密ファイルが無いこと→権限600で秘密ファイル保存→Auth利用者1人と共有・面談日時の作成→公開先の一覧確認、とした。候補が0人・複数人、既存文書、権限不足で停止する。部分失敗では削除・自動再試行をせず、手元の秘密ファイルを保って担当へ返す。

## 作成と公開先での確認

2026-11-06 16:01〜16:03 JST、既存の公開先で実行した。

```sh
node packages/server/scripts/seed-real-demo-supporter.mjs \
  --project project-00439085-4e2d-44c3-9a8 --create-real-demo-supporter
```

終了コード0。Googleでログインした体験用以外の候補は1人。Firebase Authのメール・パスワード利用者1人、対象学生への共有許可1件、面談日時1件を作った。共有は既存の `scopes: ['all'], revokedAt: null`。前回の面談は未設定、次回は作成時点から7日後の仮日時であり、約束の日時ではない。既存の文書があれば上書きせず停止する。

秘密ファイルは `~/dev/df-2026-t198/fixtures-local/real-demo-supporter.local.json` だけに排他的に作成した。既存の体験用の秘密ファイルは読み書きしていない。実UID・メール・パスワード・token・SDK例外は記録しない。アカウント作成が済んでいるので、初期設定を再実行しない。

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node packages/web/tests/real-demo-supporter-live.browser.mjs --verify-real-demo-supporter
```

終了コード0。既存のローカルPlaywrightを使い、新しいChromiumの文脈で以下を確認した。画像・trace・HAR・通信本文は保存していない。

- 手元の秘密ファイルが通常ファイル、権限600、指定のprojectId・originである。
- `/demo-lms` の既存のフォームでメール・パスワードのログインが通る。この通常アカウントには `demoAccounts` を作っていないため、体験データのエラー案内が出る。
- 同じ文脈で `/session` を開くと、担当学生APIがHTTP 200で、対象の実学生1人だけを返す。画面の「担当する学生」のリンクもその1人だけ（1/1）。学生のリンクは開かず、課題を取得しない。
- ログアウト後にログイン画面へ戻る。ブラウザの未処理例外0件。

公開画面のソース変更・デプロイは不要だった。実演する本人向けのログイン手順は[実物の経路の手順1-6](2026-11-06-issue-69-real-flow.md#1-設定とchromeでの再読み込み)に追記した。

## 試験

初めに新しい試験を実行し、対象スクリプトが未実装のため終了コード1になった。その後、要件に沿って実装した。

- `pnpm --filter server exec vitest run scripts/seed-real-demo-supporter.test.mjs`：15件成功。明示の許可・project固定、エミュレーターとの混在拒否、全ページの候補判定、候補0人/2人で無変更、既存Auth/文書の拒否、権限不足で停止、秘密ファイルの保存順・権限600・上書き/シンボリックリンク拒否、部分失敗と競合時の停止を確認。
- 体験用3組のプロフィール・体験データ・面談日時・共有許可の計15文書を試験に置き、すべて不変、書き込み先が実学生の2文書だけであることを確認。製品コードと体験用の初期設定は変更していない。既存3組での公開画面のログイン再試験は行っていない。
- 引数なしのCLI実行は終了コード1、固定の失敗コードのみ。秘密ファイルの読み書きやCloudへの接続に進まない。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：終了コード0。core 137件、extension 108件、server 132件、web 35件成功。Firestore規則38件成功。通常実行でエミュレーター専用28件はskip。見本17ファイル成功、実物の手元資料との比較は資料不在でskip。既存のWebの500 kB超chunk警告は残る。
- `pnpm progress --write`：全体25/41・必須23/37のまま。新たに完成したC条件はない。C26の共有を実演用の実学生に準備したもので、既存の完成条件や判定の基準は変えていない。

初回の公開先一覧確認は比較元なしで1/1。M1〜M3・M6は取得・解析・体験の筋書きの指標で、今回のアカウント準備から更新しない。M4・M5・M7は実機の取得・同期・課題照合を行っておらず未測定。

## 残る確認と権限の境界

学生一覧から先の実課題の表示、LMS→実Googleカレンダー→両画面の通し、再認可、M7の照合は未実施。実演時にSoraが手順書に沿って確認する。今回は秘密の保存と共有相手の誤選択・上書きを主なリスクとして試験し、API・規則の既存の境界を変更していない。支払い・新規の依存・入力解析は変更の対象外。既存の3組の公開操作を再実行したという主張はしない。

実装には既存のFirebase Admin SDKとNode標準APIを使用した。参考：[Auth利用者の管理](https://firebase.google.com/docs/auth/admin/manage-users)、[Firestore Transaction.create](https://docs.cloud.google.com/nodejs/docs/reference/firestore/latest/firestore/transaction#create_documentref_data)（既存文書があればトランザクション失敗）。
