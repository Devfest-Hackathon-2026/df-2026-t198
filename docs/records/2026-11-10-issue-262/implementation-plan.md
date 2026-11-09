# Issue #262：素材見本の作業計画

Soraが人物の色と場面の構図を選ぶため、1280×720の静止した見本を作る。Issueの2026-11-10の最新コメントと、本人が提示した第1段階の要件を対象とする。

- `packages/web/src/features/landing/story/`：Open Peepsの必要なパス、人物・机・PC・吹き出し・背景・時刻指定できる時計をSVGのReact部品にする。3配色、素材一覧、5場面、ロゴの見本を作る。
- `packages/web/src/app.tsx`：紹介ページからリンクしない `/slides/story-assets` を追加する。queryで一覧・配色・場面を直接開けるようにする。
- `packages/web/tests/story-assets.test.tsx` と `packages/web/tests/story-assets.browser.mjs`：架空の授業・締切変更・準備の前後・5時刻・全姿勢・静止表示・URL操作を確認する。
- `docs/third-party.md` とパスに隣接するLICENSE：Open Peeps CC0とreact-peeps MITの出典・必要な表記を残す。依存は追加せず、npm packの展開は作業ツリー外で行う。
- `docs/records/2026-11-10-issue-262/assets/`：1280×720の一覧、3配色、5場面、ロゴを撮影する。

新設の見本なので直接検証する。既存の紹介ページ・学生画面・面談画面・取得/API/データの契約は変更しない。各素材を選ぶ操作で見本が切り替わり、再読み込み後も同じ絵が出ること、文字と図が枠内に収まることをブラウザで確認する。場面の動き・切り替え・音・映像の制作、merge、デプロイは行わない。

検証：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`、追加のブラウザ試験、既存の紹介ページのブラウザ試験。画像も直接見て構図と言葉を確認する。C番号の完成条件は素材見本だけでは新たに満たさないため、PLANのチェックは増やさない。

draft PRを作り、画像のパス・検査の結果・色を選ぶ必要があることを残す。別系統の見直しは統合役に引き継ぐ。素材を選ぶ本人の判断と、第2段階の映像は残件とする。依存・API・共有データの変更が必要になった場合、実データが必要になった場合、要件の前提が誤っていた場合は、その操作の前で止まる。
