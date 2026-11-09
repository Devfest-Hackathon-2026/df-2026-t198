# 紹介ページ・学生画面・面談画面の見た目の作り直し：検証記録

branch `frontend-redesign`（#271 の文と main を取り込み済み）。依存・API・データの形・取得部品は変更していない。

## 変えたこと

- 紹介ページ：ヒーローの絵を、学生の時間割と支援担当の面談の一覧に同じ課題を枠で示す図に替えた。6章の id と一画面に収まる作りは保ち、しくみの章は墨の地、体験版の章だけ朱の地にした。見出しと本文の書体に Zen Kaku Gothic New を追加（[出典](../../third-party.md)）。
- しくみ：止まっていた `issue-mechanism-simple` の commit（線が光って届ける＋カメラが追う、1段3秒・6段で繰り返す、マウスでは止めない）を取り込んだ。
- 学生画面：締切を科目色の札にし、今日の曜日・日付の列に印を付け、見出しの横に今日の日付を出した。準備・手入力・メール・共有は白い面にそろえた。
- 面談画面：2つの段を1つの切り替えにまとめ、面談日時と取得時点を1本の帯にし、前回からの変化を時系列の点と線で並べた。
- 紹介ページの学生・面談の画像は、新しい見た目で撮り直した（架空の撮影日を 11/10 に進めたので、画像の締切は 11/13→11/14）。

## 結果（2026-11-10、ローカルのAuth・FirestoreエミュレーターとChromium）

| 検査 | Asia/Tokyo | UTC |
|---|---|---|
| `pnpm typecheck`・`pnpm lint`・`pnpm -r test`・`pnpm build`・`pnpm progress --check` | 成功（core 274・extension 526・web 236・server 337） | 未実施（ブラウザ検査のみUTCでも実施） |
| 紹介ページ（章の収まり・しくみ6段・拡大・既存経路） | 成功 | 成功 |
| 共用入口の往復 | 成功 | 成功 |
| 審査QA（`run-plans-browser.mjs --judge-qa`） | 28/28 | 28/28 |
| M6（`run-demo-browser.mjs`） | 8/8 | 8/8 |
| 公開デモ（`run-demo-browser.mjs --public-demo`） | 成功 | 成功 |
| `pnpm test:firestore-rules` | 成功 | — |

比較元：審査QA 28/28・M6 8/8（2026-11-10、`issue-mechanism-simple` の記録）。どちらも変わらない。

追加で流した回帰検査（Asia/Tokyo）：学生画面の収まり（`--student-fit`）、共有、手入力、面談（`run-session-browser.mjs`）、小さい画面、科目色は成功。

次の4本は失敗したが、同じ時点の main（`c573d11`）でも同じ箇所で失敗するため、この変更が原因ではない。直していない。

- `run-plans-browser.mjs`（`plans.browser.mjs:62` 準備のセルの行の高さ）
- `run-plans-browser.mjs --student-screens`、`run-digest-browser.mjs --todoku`（「今日の準備の見本を用意する」のボタンを待って時間切れ）
- `run-notifications-browser.mjs`（「クラウドからの通知：停止中」を待って時間切れ）

実際のLMS・Googleカレンダー・メール送信・公開先での確認はしていない。

## 画像

`before-*` が変更前、`after-*` が変更後。幅は 1280 と 390。データはすべて体験用の架空のもの。

- 紹介ページ：`after-landing-{home,people,how,start,privacy,try}-{1280,390}.png`
- 学生：`after-student-*.png`、授業を開いた状態 `after-student-course-*.png`
- 面談：`after-session-*.png`、課題の詳細 `after-session-detail-*.png`、学生の選択 `after-session-list-*.png`、相談 `after-plan-*.png`
