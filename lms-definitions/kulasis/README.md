# KULASISの時間割

契約は [docs/data-shapes.md](../../docs/data-shapes.md#kulasisの時間割と授業の対応issue-180)。調査の文書から作った架空見本であり、実物のDOM・授業・応答は含まない。

- `definition.json`：表・行・授業リンクのセレクター、前期と後期の取得先の名前。
- `samples/timetable.html`：UTF-8の見本。月1・月3の同じ授業と、名前は同じだが別の火2の授業。遅延ログアウトのmeta refreshを含む。
- `samples/timetable.cp932.html`：同じ内容をCP932で保存した見本。日本語の復号を確認するための入力。
- `samples/support.html`：唯一の架空のKULMS科目リンク。
- `samples/observation.expected.json`：1つ目だけがKULMSのサイトへ対応した場合の正解。課題と課題の完読結果は空。

試験は `packages/core/tests/kulasis-reader.test.mjs`・`packages/extension/tests/kulasis-collection.test.mjs`。表の向き、結合セル、ログイン切れ、未対応の扱いを別にも確かめる。実物との一致はorangeの確認待ち。
