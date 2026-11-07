# PR #133：main取り込み後の確認（2026-11-07）

`issue-130` に `origin/main` の `f366a03`（PR #128・#132・#137を含む）をmergeした。衝突は `PLAN.md`・`student.tsx`・`session-page.tsx`。学生・面談の `OperationMessages` を残し、手入力課題の終了判定にそれぞれの現在時刻を渡した。PLANの両方の証拠を残した。README・拡張はmainと同一。

## 確認結果

- 指定6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` は終了コード0。
- 通常試験：core 216、extension 327、web 84、server 180成功。エミュレーター専用のweb 2・server 66は通常試験ではskip。Firestore規則44成功。見本17ファイル成功、実物資料との比較は資料不在でskip。
- `student.browser.mjs`：学生の授業・次の締切・即時更新・終了課題・過去学期・1280/390px・ログアウトの操作成功、ブラウザ例外0。
- `session.browser.mjs`：26操作成功、ブラウザ例外0。
- `manual-assignments.browser.mjs`：締切の直前・同時・直後、日付だけの当日末尾・翌日、両画面の終了欄と削除を含む9操作成功、ブラウザ例外0。
- `judge-qa.browser.mjs`：1280/390pxの並び順・操作ボタン・候補入力・保存通知・本人向け表示など28/28成功、ブラウザ例外0。

Auth・Firestore・API・Viteを別ポートで起動し、架空データだけで実行。既存Playwrightを使い、依存は追加していない。studentとsessionのブラウザ試験は既存の既定値を保ちながら `KADAI_WEB_ORIGIN` とFirestoreの接続先指定に対応させた。

studentの初回は、承認済みの文言変更に対して旧ラベル「書いてあったこと」を完全一致で探したため失敗。セレクターだけを「LMSの課題ページに書いてあったこと」に合わせ、同じ開閉操作とリンク先の検査を通した。試験の正解、締切の境界、判定の基準は変えていない。

C18・C19・C23・C24の既存の[x]に再確認の証拠を追加。完成条件は全体31/43・必須29/39で変わらない。M6は今回未測定（既存の09:24 JST、8/8を維持）。公開先・実物のLMSやGoogleカレンダーへの操作は行っていない。mainへのmergeは統合役に残す。
