# Issue #19 最新mainとの接続確認（2026-11-06）

[最初の検証](2026-11-06-issue-19-verification.md)の後、mainの `1b97339`（面談の分割・定義の下書き・初回デプロイ）と `76283fd`（お知らせAPI）を取り込んだ。既存のAPIと面談の2段階を保持し、体験への入口と先生役APIを追加した。ブラウザ試験を面談の学生リンクと `/api/health` に合わせた。Cloud Run・Hostingの設定やデプロイ操作はこの変更に加えていない。

## 取り込み後の結果

- 指定6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` はすべて終了コード0。
- 通常の試験：core 123、extension 47、server 100、web 26、Firestore規則38、運用55、画面見本6、M3採点3が成功。serverのエミュレーター専用16件とwebの専用2件は通常実行ではskip。
- 同じAuth／Firestoreエミュレーター内で体験API5件・既存観測API5件、面談のAPI／購読2件、Chromiumの模擬LMSの通し操作を続けて実行し、すべて成功。コマンドはFirebase CLIの `emulators:exec --project demo-kadai-hisho --only auth,firestore` に、`RUN_DEMO_EMULATOR_TESTS=1 RUN_OBSERVATION_EMULATOR_TESTS=1 pnpm --filter server exec vitest run tests/demo.emulator.test.ts tests/observations.emulator.test.ts && RUN_SESSION_EMULATOR_TESTS=1 pnpm --filter web exec vitest run tests/session.emulator.test.ts && node packages/web/tests/run-demo-browser.mjs` を渡した。実行前にビルド済み。Playwrightの指定は [demo.md](../demo.md#自動で操作を確かめる)。
- 分割後の面談画面でも、締切と「前回の面談からの変化」が開いたまま変わる。応答を失った観測の再送でも履歴は増えない。別ブラウザでのログイン・390px幅・ログアウト後の表示消去を確認し、ブラウザ例外0件。更新後の面談画像も目視確認。
- M1：取り込み前30/30（100%）→取り込み後30/30（100%）、余分な課題0。架空見本17ファイルの検査も成功。正解・共通reader・定義は変更していない。
- C32を今回完了。取り込み済みmainの全体17/41・必須16/37に対して、全体18/41・必須17/37。C31の公開確認とC33の実環境アカウントは未完了のまま。

お知らせAPIの専用6件は今回の通し操作には含めていない。お知らせの有効化やGeminiの実呼び出しは行っていない。M6はカレンダーを含むため未測定。WebのJSは約869kBでビルドの500kB超の警告が残る。
