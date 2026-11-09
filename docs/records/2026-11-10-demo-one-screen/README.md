# FLOW1の検証（2026-11-10）

`/demo-lms` を1画面ずつ表示する変更。基点は main `6016ff6`。画像・データは架空の授業とエミュレーターだけを使った。

## 結果

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check`：成功。パッケージの単体試験は core 274、extension 555、server 344、web 278 件成功。既定のskipは server 147、web 7 件。
- `TZ=UTC pnpm --filter web test`：278件成功、7件skip。
- M6：8/8（100%）。8手順の値・反映順序・判定は維持。[手順別結果](m6.json)。比較元は [11月9日の8/8](../2026-11-09-issue-247/scenario/m6.json)。
- 審査QA：28/28、ブラウザ例外0。[28件の結果](judge-qa.json)。判定の変更なし。
- `pnpm test:public-demo:browser`：成功。共用の入口、ログイン失敗からの回復、支援担当への反映、利用枠の案内、初期化を確認。
- 新規表示試験：7項目成功、ブラウザ例外0。[結果](screen-flow.json)。初回の約0.8秒、延長後の約2.5秒、読み取り中／切り替え待ち中のタブ操作による中止、自動OFFと動きを減らす設定の手動案内、並列表示、390pxの横はみ出しを確認。
- `demo-live.browser.mjs --verify-local-demo`：3組、6ブラウザ文脈、他組への読み取り拒否24件、学生・面談への反映に成功。[結果](live-operations.json)。
- 完成条件：全体37/43・必須33/39のまま。新たに満たすC番号はない。

## 試験の変更箇所

- `demo.browser.mjs`：最初に「3つ並べて見る」を押す。M6の8手順と判定は変更しない。
- `demo-flow.browser.mjs`：同じ並列表示の選択だけを追加。締切の値・反映前後の比較・スマホのタブ操作は維持。
- `demo-live.browser.mjs`：並列表示と閉じた先生役の欄を開く操作を追加。学生の選択は同じUIDのリンクで行い、表示名がある場合にも対応。候補版を確認するエミュレーターモードを追加したが、組の分離・反映順序の判定は共通。
- `run-demo-browser.mjs`：新しい表示試験と、架空の3組での上記モードを実行。認証値はメモリだけで渡す。
- `demo-screen.browser.mjs`：新規の表示・切り替え試験。

## 画像と文書

[1280px](one-screen-1280.png)・[390px](one-screen-390.png) を目視し、タブ・案内・締切の文字と1画面ずつの表示を確認した。

`docs/demo.md` と `docs/ui-words.md` を更新し、決定をD48に記録した。説明資料の「説明資料_貼り付け用_v7.md」第6節の導入と手順2〜4も更新し、Driveから読み戻して変更箇所以外を保ったことを確認した。

LMS内部のCSSは元の全行を保ったまま末尾に追加した。`pages.tsx`・`reader.ts`、API・データ・依存、server・拡張・紹介・学生・面談の実装は変更していない。

## 残る確認

この記録は候補版のローカル検証。本番への配備と、配備後の `--verify-live-demo` は実施していない。実際の大学LMS・Googleカレンダー・メールの試験ではない。
