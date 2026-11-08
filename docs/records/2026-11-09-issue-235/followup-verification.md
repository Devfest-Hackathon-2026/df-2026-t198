# PR #238 追加修正の検証（2026-11-09）

## 変更と確認

- 8色を青・青緑・緑・黄土・桃・紫・空色・茶に変更。架空の6授業はすべて別色になった。授業名、朱の締切変更、状態、準備の点線は保持した。
- `assignCourseColors(courses)` が全授業をsystem・courseIdの順に並べ、ハッシュの位置から空き色へずらす。8授業までは重複しない。8を超えると再利用する。改名・並び替え・表示の絞り込みでは変わらず、授業の増減では変わりうる。
- 学生・面談・体験の入口のReact contextに、絞り込み前の同じ全授業一覧から作る割当を置いた。課題行・手入力課題・カレンダー・面談表と詳細・準備相談の時間割・体験の学生と支援担当が参照する。授業未指定と準備予定には色を付けない。
- 既存のハッシュ単独の割当では6授業に色が重なる。新関数を呼ぶ6授業の試験で未実装の失敗を確認後に実装した。関連単体試験は14件成功（変更前4件→14件）。
- 指定6検査はすべて終了0。core 274件・extension 509件・server 312件・web 166件成功（webは変更前156件）。エミュレーター専用試験等の通常skipは維持。見本17ファイル成功、実物との照合は対象外。
- 審査QAは28/28→28/28、ブラウザ例外0（[操作結果](qa/operations.json)）。M6は8/8→8/8（[8手順](m6/m6.json)）。既存の正解・判定基準を変更せず実行した。両方ともローカルAuth/FirestoreとChromium、架空データのみ。
- 色のブラウザ確認は10/10→14/14、例外0（[操作結果](after.json)）。1280/390pxで全6授業の別色と、表示が絞られた各画面の一致、準備の点線を確認。面談表の枠/内容は両幅140/138pxで維持。

## コントラスト

朱の変更文字 `#C43A26` を固定して4.5:1以上にするには、地のL*は93.692以上が必要。依頼の88〜93程度という目安から上端の約94へ寄せた。表の「文字最小」は本文・補足・リンク・朱の変更文字の最小値。全色4.5:1以上。帯は薄い地・paper・sheetのすべてに対して3:1以上。文字を帯の上に載せない。試験はCSSトークンから計算する。

| 色 | 薄い地 | 濃い帯 | L* | 文字最小 | 帯/地 | 帯/paper | 帯/sheet |
|---|---|---|---:|---:|---:|---:|---:|
| 0 青 | #e6eefe | #2f63b6 | 93.94 | 4.529 | 5.034 | 5.498 | 5.864 |
| 1 青緑 | #caf6ef | #147b69 | 93.75 | 4.507 | 4.411 | 4.841 | 5.164 |
| 2 緑 | #d5f6d5 | #39803a | 93.82 | 4.515 | 4.158 | 4.555 | 4.858 |
| 3 黄土 | #faefa7 | #8a751c | 93.82 | 4.515 | 3.871 | 4.241 | 4.524 |
| 4 桃 | #fde8f4 | #a34882 | 93.94 | 4.529 | 4.735 | 5.172 | 5.517 |
| 5 紫 | #f4eafd | #7e50aa | 93.96 | 4.531 | 4.989 | 5.446 | 5.809 |
| 6 空色 | #d4f3fd | #237b99 | 93.96 | 4.532 | 4.133 | 4.511 | 4.811 |
| 7 茶 | #f6ecdf | #816342 | 93.84 | 4.518 | 4.736 | 5.185 | 5.531 |

## 画面と再実行

既存のbefore画像は保持し、after画像10枚を今回の版で撮り直した。下記の時間割、体験、面談を直接目視した。390pxでは表の枠内を横へスクロールして読む。

| 画面 | 1280px | 390px |
|---|---|---|
| 学生 | [画像](after-student-1280.png) | [画像](after-student-390.png) |
| 時間割 | [画像](after-timetable-1280.png) | [画像](after-timetable-390.png) |
| 面談 | [画像](after-session-1280.png) | [画像](after-session-390.png) |
| 体験・学生 | [画像](after-demo-student-1280.png) | [画像](after-demo-student-390.png) |
| 体験・支援担当 | [画像](after-demo-supporter-1280.png) | [画像](after-demo-supporter-390.png) |

- 6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`。
- 色確認：`node packages/web/tests/run-course-colors-browser.mjs`。QA：`node packages/web/tests/run-plans-browser.mjs --judge-qa`。M6：`node packages/web/tests/run-demo-browser.mjs`。
- 各ブラウザコマンドは`pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore`を通す。色確認とQAは一時設定を`--config-from-env`で読み、Auth 9195 / Firestore 8295を使用。M6は9099 / 8085。`PLAYWRIGHT_MODULE`は導入済みのPlaywrightを指定。firebase.jsonは変更していない。
- [共通検証の結果](followup-artifact-receipt.json)は今回のソースと検査・目視を結び付けた作者自身の確認。Claudeによる見直しは未実施。
- PLANの既存C18・C23・C24・C34へ証拠を追記し、`pnpm progress --write`を実行。完成条件は全体36/43・必須32/39で変わらない。
- 紹介ページ・ロゴ・LMSの見た目、index.html・public・main.tsx・firebase.json、取得部品、依存・API・保存形式は変更していない。デプロイ・mergeは未実施。色の好みはSora・orangeが確認する。
