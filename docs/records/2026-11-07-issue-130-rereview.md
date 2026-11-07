# PR #133の再確認

2026-11-07。Claudeのrequest-changes（head 9cff24e）に対応。origin/mainをmergeし、PR #100の手入力の課題と、今回の一覧・通知を両方残した。PR #135は取り込んでいない。実物LMS・Googleカレンダー・fixtures-localは対象外。

## 指摘への対応

| 指摘 | 修正と確認 |
| --- | --- |
| 390pxの時限が画面外へ出る | 背景付きの固定列に変更。右端まで横に動かしても時限が見えることをブラウザで確認 |
| 1280pxでも左右に動かせると案内する | 案内は850px以下だけに表示。学生のカレンダー・時間割、面談の時間割を画像で確認 |
| 文言表が古い | `docs/ui-words.md`を「LMSの課題ページに書いてあったこと」「LMSの課題ページの締切」に更新 |
| 前回の約束の順序 | 準備の一覧と同じ比較関数で日付・開始時刻・ID順にする。日時も表示し、ブラウザで順序を照合 |
| ①に準備の説明がない | 準備の一覧より前に「準備は、課題に取り組む時間のことです。」を表示 |
| 体験用LMSの写真がない | 枠3の2ボタンと説明を含め、1280px・390pxを追加 |
| メールから開いた結果と次の知らせが重なる | `PlanLinkAction`を学生画面の通知と共有。リンクの結果のあとで準備を外すと、取消の知らせだけになることを両幅で確認 |

黄色の説明は変わった締切がある間だけ出す。本人の面談の読取失敗時にも「学生を選び直す」と案内しない。

## 試験

- 追加したブラウザ確認：修正前21/28（7項目失敗）→修正後28/28、例外0。[修正前](2026-11-07-issue-130-rereview/red-operations.json)、[修正後](2026-11-07-issue-130-rereview/green-operations.json)。初回実装時の0/14→14/14とは項目数が違う。
- 指定6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` 成功。core 216、extension 303、server 180、web 74の単体試験が成功。規則44件、Hosting8件などのルート試験も成功。通常の単体試験ではエミュレーター専用など68件がskipされる。buildには既存のchunkサイズ警告がある。
- 既存の準備予定：[10操作成功](2026-11-07-issue-130-rereview/plans-operations.json)。メール：[10操作成功](2026-11-07-issue-130-rereview/digest-operations.json)。手入力の課題：[8操作成功](2026-11-07-issue-130-rereview/manual-operations.json)。いずれもブラウザ例外0。
- M6：日本時間09:24:04測定、8/8（100%）。[結果](2026-11-07-issue-130-rereview/m6.json)。比較元はこのPRの09:00:22の8/8。同じ`demo.browser.mjs`の手順・分母・判定を使用し、見本の正解や指標の基準は変更していない。
- Auth・FirestoreエミュレーターとAPI・Viteのポートを分け、架空データだけを使用。`run-plans-browser.mjs --judge-qa`、引数なし、`--manual-assignments`、`--demo-regression`と`run-digest-browser.mjs`を実行した。再現方法は[初回記録](2026-11-07-issue-130.md)を参照。
- PNG8枚の幅とハッシュを検査し、全画像を直接開いて確認。[写真の検査結果](2026-11-07-issue-130-rereview/photo-receipt.json)。写真内の日付・時刻は試験用で、実物の授業や課題ではない。

## 画面

| 画面 | 1280px | 390px |
| --- | --- | --- |
| 学生 | [画像](2026-11-07-issue-130-rereview/student-1280.png) | [画像](2026-11-07-issue-130-rereview/student-390.png) |
| 支援担当 | [画像](2026-11-07-issue-130-rereview/supporter-1280.png) | [画像](2026-11-07-issue-130-rereview/supporter-390.png) |
| 候補の入力 | [画像](2026-11-07-issue-130-rereview/candidate-1280.png) | [画像](2026-11-07-issue-130-rereview/candidate-390.png) |
| 体験用LMS | [画像](2026-11-07-issue-130-rereview/demo-lms-1280.png) | [画像](2026-11-07-issue-130-rereview/demo-lms-390.png) |

## 残ること

Claudeの再見直し、merge、公開先への反映・動作確認、人による画面評価は未実施。PR全体が600行を超えるためmergeの関所には人の合意と`human:ok`が必要。Issueにラベル付与の許可がないため付けていない。

PR #135が後から入る場合は、`preparation-plans.tsx`の通知・共通の並び順・`.preparation-buttons`、`session-page.tsx`の前回の約束と手入力、`session-planning.tsx`の通知、`student.tsx`の手入力・通知の範囲を残す。#135のAPI応答と締切判定はこのPRでは変更していない。

任意指摘のうち、メール本文での「準備」の明記、メール見本へのリンク最小高さの適用、PlanFormの選択リセットや重複条件の整理は今回の必須範囲に含めていない。
