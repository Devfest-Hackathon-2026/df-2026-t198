# Issue #252 面談画面の確認

確かめる／相談するの画面切替を件数付きの2つの大きなリンクにし、前回の面談・次の面談・情報の取得時点を3カードにした。締切を主な領域、変化と前回の約束を脇に置いた。締切表に授業の色面と帯、締切変更の朱、要確認の黄、残日数を付けた。提出済みは従来どおり締切表から外し、変化欄に完了の印を出す。

学生本人・支援担当は同じ部品を使い、本人の見出し・学生選択への戻り先・予定の保存と取消の権限を保つ。共有部品、トークン、API、保存データ、依存、取得部品の変更なし。

## 検査

| 検査 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 終了0、依存の追加なし |
| `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` | 終了0。core 274、extension 509、web 213、server 312件成功。web 2、server 128件は既定の実行条件でskip。見本17ファイル成功 |
| `session.browser.mjs` | [既存26操作成功、ブラウザ例外0](session-operations.json)。日時編集・学生切替・課題詳細・開閉とキーボード・即時更新・共有取消・ログアウトを確認 |
| `session-redesign.browser.mjs` | [両利用者×2画面×2幅の8画面成功](after.json)。カード横並び／縦並び、締切優先、3授業の別色、状態と残日数、横のはみ出しなし |
| 審査QA `run-plans-browser.mjs --judge-qa` | [28/28、ブラウザ例外0](qa/operations.json)。比較元は[Issue #240 main反映後](../2026-11-09-issue-240-main-sync/judge-qa.json)の28/28 |
| M6 `run-demo-browser.mjs` | [8/8（100%）](m6/m6.json)。[LMS操作の通し](m6/flow.json)と[リセット等](m6/issue-68.json)も成功。比較元は[Issue #225](../../../packages/web/tests/evidence/issue-225/m6.json)の8/8 |
| `pnpm test:sessions:emulator` | Auth・Firestoreで2/2成功。既存のAPI・共有・購読の確認 |
| `pnpm progress --write` と `pnpm progress --check` | 全体36/43、必須32/39。既存のC23・C27の証拠を追記。新たな完了条件は増やしていない |

Auth・FirestoreエミュレーターとChromium、架空のデータだけを使用。ポートの使用状況を実行前に確認し、他の作業者のプロセスは止めていない。公開先・実LMS・実Googleカレンダー、M1〜M5・M7は今回未測定。機能の判定基準を変えていない。

既存の面談ブラウザ試験には表への移行前の操作が残っていたため、表の課題名を押して詳細を見る経路と現在の文言へ更新した。「時間割が確認画面にない」「詳細を選ぶ前にLMSリンクがない」「候補2件・未保存」「取消で消える」などの検査は維持。締切境界の独立した試験は変更せず、属性の形を既存と同じに保った。

## 画面の写し

ブラウザの表示領域は1280×800、390×844。ページ全体の写しなので縦長になる。表はスマートフォンで横スクロールでき、右端の影で続きを示す。[撮影前](before.json)・[撮影後](after.json)は同じ固定時刻・架空データ。

| 対象 | 1280の前 → 後 | 390の前 → 後 |
|---|---|---|
| 支援担当・確かめる | [前](before-supporter-check-1280.png) → [後](after-supporter-check-1280.png) | [前](before-supporter-check-390.png) → [後](after-supporter-check-390.png) |
| 支援担当・相談する | [前](before-supporter-plan-1280.png) → [後](after-supporter-plan-1280.png) | [前](before-supporter-plan-390.png) → [後](after-supporter-plan-390.png) |
| 本人・確かめる | [前](before-student-a-check-1280.png) → [後](after-student-a-check-1280.png) | [前](before-student-a-check-390.png) → [後](after-student-a-check-390.png) |
| 本人・相談する | [前](before-student-a-plan-1280.png) → [後](after-student-a-plan-1280.png) | [前](before-student-a-plan-390.png) → [後](after-student-a-plan-390.png) |

[検証契約](artifact-contract.json)に沿い、機械検査・画面写し・実装者の目視確認を同じ版に結び付けた[記録](artifact-receipt.json)。これは独立レビューではない。別系統のClaudeによるレビューとmerge判断は残る。

## 文言と判断

[Argon・kuchiguse・yomiyasuの点検と採否](copy-review.md)。前回の未設定表示に「面談」を補った。Sora指定の画面名と情報カード名、共通部品の状態名を維持。「締切なし」は対象期間に該当しないだけの状態と混同するため採用しなかった。

準備の件数は提案済み候補の異なる日付・時限の数。同じコマを複数課題が使える場合は1つと数える。個人の予定全体を調べた「空きコマ数」とは表示しない。候補を選ぶまでは保存しない。

merge・デプロイは実施しない。色と読み取りの好みはPRの写しで確認する。

## 再実行

手元のPlaywrightの `index.mjs` を `PLAYWRIGHT_MODULE` に指定する。使用中の9099・8085ポートが空くまで待つ。

```sh
pnpm exec node scripts/run-emulators.mjs --config-from-env --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-session-browser.mjs"
pnpm exec node scripts/run-emulators.mjs --config-from-env --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-plans-browser.mjs --judge-qa"
pnpm exec node scripts/run-emulators.mjs --config-from-env --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs"
pnpm test:sessions:emulator
```
