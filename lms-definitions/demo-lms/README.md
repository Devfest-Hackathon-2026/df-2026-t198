# 模擬LMSの読み取り定義

Issue #19のWeb画面で使うための定義と、手書きの架空のHTML見本。実際の大学のページ・課題・アカウントは使っていない。

`definition.json` を既存の `readPage` に渡す。`samples/home.html` は授業、`materials.html` は課題一覧、`detail.html` は課題の詳細、`empty.html` は明示的に空の一覧を表す。CoursePowerの表やJavaScriptハンドラーではなく、section・ul・dlとリンクのid属性で構成する。

試験は `packages/core/tests/demo-lms.test.mjs`。授業の曜日・時限、課題IDと提出状態、締切の延長前後、明示的な空一覧と不正なページの区別を確かめる。既存の読み取りコード・型・既存見本の正解は変更しない。

## 画面へつなぐとき

- Web画面がFirestoreの体験データから同じ構造を描き、そのDOMの `outerHTML` を渡す。見本をそのまま返す処理や台帳を直接更新する処理で置き換えない。
- `readPage` の文脈には `utcOffset: '+09:00'`、一覧には `courseId`、詳細にはさらに `sourceId` を渡す。
- リンクをたどる機能は現行の読み取り定義には無いため、`materialsLink`・`detailLink` はnull。読み取り結果のIDから模擬ページを選ぶ。
- `listEnd` は終端の印を宣言するだけで、現行の `readPage` は一覧の完了を判定しない。観測を作る側で終端まで描画されたことを確かめてから `listComplete: true` にする。
- この試験は保存したHTMLの読み取りだけを確認する。Firestoreとの接続、先生役の操作、ログイン、観測APIへの送信、ブラウザでの一連の操作、公開URLは未確認。C31〜C33は未完了のまま。
