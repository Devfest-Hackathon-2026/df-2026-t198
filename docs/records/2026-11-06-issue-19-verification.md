# Issue #19 接続部分の検証（2026-11-06）

対象：branch `issue-19-connect`。PR #30で追加済みの模擬LMS定義を変更せず、Firestoreの体験データから描いたDOMを共通reader・観測APIにつなぐ変更。

## 結果

- 指定6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` が終了コード0。
- `pnpm test`：core 123、extension 47、server 82、web 23、Firestore規則38、運用55、画面見本6、M3採点3が成功。通常実行ではserverのエミュレーター専用10件、webの専用2件はskip。
- Auth／Firestoreエミュレーター：`RUN_DEMO_EMULATOR_TESTS=1 RUN_OBSERVATION_EMULATOR_TESTS=1 pnpm --filter server exec vitest run tests/demo.emulator.test.ts tests/observations.emulator.test.ts` をFirebase CLIの `emulators:exec --project demo-kadai-hisho --only auth,firestore` 内で実行。体験API5件と既存の観測API5件が成功。
- `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" pnpm test:sessions:emulator`：既存の学生一覧・面談日時API・許可取消後の購読停止の結合試験2件が成功。
- Chromium： [run-demo-browser.mjs](../../packages/web/tests/run-demo-browser.mjs) を [demo.md](../demo.md#自動で操作を確かめる) のコマンドで実行し成功。学生と支援担当の別コンテキストでメール／パスワードログイン、事前の台帳なしからDOM→観測API→時間割・面談への更新、空授業、提出済みの除外、先生役の変更が台帳に直結しないこと、締切変更後の両画面・変更欄の更新を確認。観測を保存した後のHTTP応答を落とし、同じ観測IDでの再送で履歴が増えないことも確認。390px幅の横はみ出しなし、ログアウト後の表示消去、ブラウザの例外0件。
- ローカルの画像：`/tmp/kadai-i19-evidence/demo-wide.png`、`demo-narrow.png`、`session-updated.png`。狭い画面と更新後の面談画像を目視確認。操作結果は同ディレクトリの `operations.json`。架空のデータだけを写し、画像・通信本文・認証の値はgitに入れない。
- `pnpm metrics:m1`：比較元はPLANの同日記録30/30（100%）。今回も30/30（100%）、余分な課題0。見本・正解・読み取り定義・指標の測り方は変更していない。
- `check:samples`：既存の架空見本17ファイル成功。`fixtures-local/` は読み書きしていない。

## 完成条件と残り

C32を完了。共通readerへの製品固有の分岐追加なしで、定義と実際に描いたDOMから読めることを確認した。PLANの数字は全体15/41・必須14/37から、全体16/41・必須15/37へ更新。

C31は公開URLで未確認。C33はエミュレーターの学生・支援担当アカウントとブラウザ操作までは確認したが、実環境の体験アカウントの用意と公開先での操作は未確認なので未完了のまま。実環境の設定・アカウント作成とデプロイは今回実行していない。#18側へ [demo.md](../demo.md#公開する担当者へ) の前提を渡す。

M6はカレンダーを含む筋書き全体のため未測定。今回のブラウザ試験をM6の成功率として数えない。M2〜M5・M7は今回の体験接続の測定対象外。Webビルドは成功するが、生成JSが約863kBでViteの500kB超の警告が出る。分割は今回の完了条件外として残す。

## 認可と修正範囲

体験データ・プロフィールは本人だけ読め、全クライアント書き込みを拒否。先生役の更新は学生本人だけ、他人・支援担当・通常アカウントからの操作を拒否し、期待した締切との差異は409。観測保存トランザクションでもプロフィールを確認し、体験UIDの実LMS観測、支援担当と不正なプロフィールからの観測を拒否。エラーは固定コードのみ。実カレンダーのAPIは今回の対象外で、将来の接続時にも体験プロフィールによる拒否が必要。

面談の既存コードでは、ページ表示後に届いた変更が「現在時刻より後」と判断され、次の1分タイマーまで変更欄に出なかった。新しい通知を表示する試験が修正前に失敗することを確認し、購読通知と同時に表示用時刻を更新する最小修正で成功した。画面の流れ・データ・API・権限は変更していない。

判断：今回の一連の操作で変更欄が遅れる不具合に限り修正を採用。Fは実運用未確認、S2（表示の遅れ）、C2（局所修正と回帰試験）、ブラウザで再現した原因への確信度は高。追加のAPI・依存・デプロイは増やさない。その他の性能改善とカレンダーは残件とした。
