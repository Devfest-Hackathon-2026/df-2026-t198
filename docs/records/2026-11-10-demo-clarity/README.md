# 体験版と学生画面の案内（Issue #289・#292）

基点はPR #293を取り込んだ `5ca9a543310365407f5c60aec0acabf2042b65d9`。Auth・Firestoreエミュレーター、ローカルAPI、Chromiumで架空の授業・課題だけを確認した。

## 変更と検査

| 対象 | 表示・動作 | 機械検査 |
|---|---|---|
| A | `/demo-lms` のヘッダーの画面ナビをログイン前後で隠す | demo-screen：前後ともナビ0件。student-future：学生画面のナビ1件を維持 |
| B | 大学のLMSとToDokuの2画面を分け、間に読み取りの矢印。並列表示のLMSの境界は3px | demo-screen：見出し・副題・ToDokuグループ・LMSの丸アイコン0件・境界3px |
| C | 選択画面が変わったら、固定ヘッダー下8pxへ切り替え行をスクロールする。初回表示はスクロールしない | demo-screen：延長後の学生ボタンがヘッダーより下かつ画面内（1280×800、1440×900、390×844） |
| D | 今週0件で未来の締切があるとき、近い順で最大3件。残りは「その他の締切」。過去の締切は先の3件に混ぜない | student-upcoming：未来4件＋過去1件、今週あり、未来なしの3検査。student-future：1440・390で実画面を確認 |
| E | 手順3だけ「LMSをもう一度開く」 | demo-screen：延長後、読み取り前のボタンを検査 |
| F | 手順2に、下の先生役の操作とメールの見本への案内を足す | demo-screen：指定の一文の存在を検査 |

切り替えは既存の `aria-pressed` 付きボタンを維持した（基点にも `role=tab` はない）。読み取り・自動切り替えの待ち時間と中断、LMS内のDOMとセレクタは変更していない。画面の色は既存のトークンを使用。LMSは白地・細い灰色枠・小さい角、ToDokuは既存の画面ボタンを使う。

## 実測

比較元の回帰試験は [PR #293の記録](../2026-11-10-triptych-columns/README.md#回帰試験)。今回の数字・実行結果は [集計](verification.json)、各検査のJSONを参照。

- 審査QA：[28/28](judge-qa.json)、ブラウザ例外0件（比較元28/28）。
- M6：[8/8](m6.json)、100%（比較元8/8）。模擬カレンダー、実物のGoogleカレンダーは対象外。
- demo-screen：[12検査群成功](screen-flow.json)、自動・手動・中断・動きを減らす設定・スマホを含む（比較元7検査群）。既存の判定は維持し、A・B・C・E・Fを追加。
- mobile-layout：[68/68場面](mobile-check.json)、横はみ出し・小さい操作対象・潰れた文字・小さすぎる文字・ブラウザ例外0件（比較元68/68）。
- triptych-columns：[9/9場面、27/27枠](triptych.json)（比較元9/9・27/27）。
- 既存の体験runnerも成功。リセット、DOMの読み取り、再送、3組6コンテキスト・他組への24件のアクセス拒否を確認。
- M1〜M5・M7は対象外のため未測定。C18・C32・C33・C34の既存完了を維持する回帰確認で、新しいC番号の完了を増やすものではない。

## 画面写真

入口、各画面、並列表示、学生画面の前後は指定のビューポートから全ページ撮影。自動切り替え直後はビューポートだけを撮影した。アニメーションは撮影時に停止した。

| 場面 | 1440×900 | 390×844 |
|---|---|---|
| ログイン前の入口 | [入口](entry-1440.png) | [入口](entry-390.png) |
| 大学のLMS | [LMS](single-lms-1440.png) | [LMS](single-lms-390.png) |
| 学生の画面 | [学生](single-student-1440.png) | [学生](single-student-390.png) |
| 支援担当の画面 | [支援担当](single-supporter-1440.png) | [支援担当](single-supporter-390.png) |
| 並列表示 | [3列](parallel-1440.png) | [幅を狭めた状態](parallel-responsive-390.png) |
| 自動切り替え直後 | [学生](auto-switch-1440.png) | [学生](auto-switch-390.png) |
| 学生画面Dの修正前 | [前](student-future-before-1440.png) | [前](student-future-before-390.png) |
| 学生画面Dの修正後 | [後](student-future-after-1440.png) | [後](student-future-after-390.png) |

[1280×800の自動切り替え直後](auto-switch-1280.png)も保存した。390pxでは既存どおり並列の操作を隠し、選択中の1画面を表示する。スマホの並列写真はPCで並列を選んでから390pxに狭めた状態であり、スマホに3列を追加したものではない。

Dの修正前は、学生画面の `page.tsx` だけを基点の内容に戻して撮影し、直後に作業版へ復元した。他の変更は維持。同じ日付条件の架空データを作り、[前](student-future-before.json)の「今週の締切 0」と[後](student-future-after.json)の「これからの締切 3」を検査した。

## 文言一覧（動画撮影用）

- 本文の「体験用LMS」→「大学のLMS」、副題「大学の授業支援システム」→「体験用の見本」。
- ToDokuのグループ見出し「ToDoku」と、間の「拡張が読み取る →」を追加。1050px以下は矢印だけ。
- 並列の「LMS」→「大学のLMS（見本）」、「学生」→「ToDoku · 学生の画面」、「支援担当」→「ToDoku · 支援担当の画面」。
- 学生画面は条件により「今週の締切」→「これからの締切」。今週ありの場合のregion名は維持。
- 手順3の「LMSを開く」→「LMSをもう一度開く」。手順1と学生画面内のリンクは維持。
- 手順2に `ほかの課題の延長やお知らせは、下の「先生役の操作・メールの見本」から` を追加。
- 自動化で使っている切り替えボタンのアクセシブル名「LMS」「学生」「支援担当」は維持。画面内表示「学生の画面」「支援担当の画面」も維持。

## 変更ファイル

製品：`packages/web/src/app.tsx`、`features/demo/{page.tsx,triptych.tsx,redesign-demo.css}`、`features/student/page.tsx`（featuresは同じweb/src内）。文言：`docs/ui-words.md`。

試験：`packages/web/tests/{student-upcoming.test.tsx,student-future.browser.mjs,demo-screen.browser.mjs,run-plans-browser.mjs,run-demo-browser.mjs,demo.browser.mjs,demo-reset.browser.mjs,demo-live.browser.mjs,demo-announcements.browser.mjs}`。文言の期待値を更新した既存試験は最後の4つで、ボタンの新旧2名だけを許可。demo.browserのログイン前ナビの期待は空配列に変更。指標の分母・正解データ・判定基準は維持。

記録：このフォルダーと `PLAN.md` の証拠へのリンク。server・extension・core、読み取り定義、LMS本文の `pages.tsx`、依存・API・データの形の変更なし。本番へのデプロイ・mergeなし。

## 再実行

依存を `pnpm install --frozen-lockfile` で用意し、必要なら既存のPlaywrightの入口を `PLAYWRIGHT_MODULE` に指定する。エミュレーターを使うコマンドは同時に実行しない。

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --screen"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --mobile"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --triptych"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-plans-browser.mjs --judge-qa"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-plans-browser.mjs --student-future"
```

`ARTIFACT_EVIDENCE_DIR` でこの記録とは別の出力先を指定する。Dの修正前だけは基点の学生pageを別の検証環境で使い、`CLARITY_PHASE=before` を指定する。
