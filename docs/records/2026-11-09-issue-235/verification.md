# Issue #235 検証記録（2026-11-09）

## 結果

- 授業IDと接続先のハッシュから8色を選び、学生・カレンダー・面談・体験で共用する。授業名は残す。手入力課題も授業を指定したものに印を付け、授業未指定と準備予定には付けない。
- 指定6検査は終了0。core 274件、extension 509件、server 312件、web 156件が成功。エミュレーター専用など通常実行でskipする試験はそのまま。見本は17ファイル成功、実物との照合は対象外。
- 審査QA：比較元はIssue #226の28/28、今回も28/28、ブラウザ例外0（[全操作](qa/operations.json)）。
- M6：比較元はIssue #226の8/8、今回も8/8、既存の判定を変更せず成功（[8手順](m6/m6.json)）。旧締切の朱の打ち消し線・再送時の不変も既存ブラウザ試験で成功。実物のLMS・Googleへの送信は対象外。
- 追加のブラウザ確認：10/10、ブラウザ例外0（[結果](after.json)）。授業色の一致、授業名、準備の点線、面談表の高さを1280/390pxで確認した。
- 面談表の外枠/内容：1280pxで434/138px → 140/138px、390pxで140/138px → 140/138px（[変更前](before.json)）。グリッドを上端ぞろえにし、横スクロールの枠が詳細の高さまで伸びる問題を修正した。
- 追加の単体試験は4件。並び替え・表示の部分集合・授業の改名で色が変わらないこと、接続先を含む割当、8色のAA比、同名授業の保存済みIDからの対応、手入力・準備・未指定の区別を確認した。

## 配色

共通作業前提にあるデザインシステムの `ds-full/project/tokens.css` は、分類用パレットを持たなかった。Issueの許可に従いappスコープに8対を追加した。帯の上には文字を置かず、文字は既存の本文・補足・リンク・変更色を使う。色の直書きはtokens.cssに限定する既存試験も成功した。

| 番号 | 薄い地 | 濃い帯 | 本文 | 補足 | リンク | 朱の変更文字 |
|---|---|---|---:|---:|---:|---:|
| 0 | #eef3fa | #42689a | 14.66 | 6.85 | 6.21 | 4.73 |
| 1 | #eaf5f1 | #367467 | 14.65 | 6.84 | 6.21 | 4.73 |
| 2 | #f3f5e8 | #6b7338 | 14.82 | 6.92 | 6.28 | 4.78 |
| 3 | #faf3e4 | #8b682e | 14.79 | 6.91 | 6.27 | 4.77 |
| 4 | #f9f0f6 | #8a5979 | 14.65 | 6.84 | 6.21 | 4.73 |
| 5 | #f0f4f7 | #566e82 | 14.78 | 6.90 | 6.26 | 4.77 |
| 6 | #eff6eb | #507b45 | 14.83 | 6.93 | 6.28 | 4.79 |
| 7 | #f3f0fa | #716093 | 14.52 | 6.78 | 6.15 | 4.69 |

各数値は相対輝度による比。最小4.69:1でAAの4.5:1を満たす。帯と地は全8対で3:1以上。`packages/web/tests/course-color.test.ts` でトークンから毎回計算する。ハッシュはFNV-1aと上位ビットの折り込みを使い、8色へ割り当てるため異なる授業が同色になる場合はある。色を割り当てた順番や授業名では決めない。

## 画面

すべてローカルAuth/FirestoreとChromium、架空データのみ。変更後は既存のメール見本操作で準備予定を1つ加え、点線との区別も確認した。390pxの時間割と面談表は既存どおり枠の中を横スクロールする。

| 画面 | 1280px 前 / 後 | 390px 前 / 後 |
|---|---|---|
| 学生 | [前](before-student-1280.png) / [後](after-student-1280.png) | [前](before-student-390.png) / [後](after-student-390.png) |
| 時間割 | [前](before-timetable-1280.png) / [後](after-timetable-1280.png) | [前](before-timetable-390.png) / [後](after-timetable-390.png) |
| 面談 | [前](before-session-1280.png) / [後](after-session-1280.png) | [前](before-session-390.png) / [後](after-session-390.png) |
| 体験・学生 | [前](before-demo-student-1280.png) / [後](after-demo-student-1280.png) | [前](before-demo-student-390.png) / [後](after-demo-student-390.png) |
| 体験・支援担当 | [前](before-demo-supporter-1280.png) / [後](after-demo-supporter-1280.png) | [前](before-demo-supporter-390.png) / [後](after-demo-supporter-390.png) |

## 再実行と残件

- 6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`。
- ブラウザは共通作業前提の `PLAYWRIGHT_MODULE` と `scripts/run-emulators.mjs --config-from-env --project demo-kadai-hisho --only auth,firestore` を使う。コマンドは審査QAが `node packages/web/tests/run-plans-browser.mjs --judge-qa`、M6が `node packages/web/tests/run-demo-browser.mjs`、追加確認が `node packages/web/tests/run-course-colors-browser.mjs`。
- 使用中の通常ポートを止めず、QAと追加確認は一時設定のAuth 9195 / Firestore 8295で実行した。M6は通常の9099 / 8085。API・Webは追加確認で8195 / 5195、QAで8180 / 5178、M6で8080 / 5177。ルートのfirebase.jsonは変更していない。
- 画面の文言は変更していない。依存・API・保存形式、紹介ページのbrand・ロゴ、架空LMSの配色、PWA担当のファイルは変更していない。
- 共通artifact checkerでも同じソースに対する10件の操作と画像確認を記録した（[検証結果](artifact-receipt.json)）。これは作者自身の確認であり、Claudeの別系統レビューは残る。
- 最終的な配色の好みはSora・orangeが確認する。mergeとデプロイは未実行。完成条件の総数は変えず、既存条件へ証拠を追記した。
