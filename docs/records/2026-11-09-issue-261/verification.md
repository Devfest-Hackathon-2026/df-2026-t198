# Issue #261 検証記録

比較元は42b0ff8。Auth・FirestoreエミュレーターとChromiumで架空の体験データだけを使用した。画面の記録は1280×800と390×844。完成条件は全体36/43・必須32/39を維持し、C18・C23・C33・C34の証拠を追記した。

## 変更と画面

| 対象 | 1280px | 390px |
|---|---|---|
| 面談の確かめる画面 | [前](before-session-1280.png) / [後](after-session-1280.png) | [前](before-session-390.png) / [後](after-session-390.png) |
| 学生の今週の締切 | [前](before-student-1280.png) / [後](after-student-1280.png) | [前](before-student-390.png) / [後](after-student-390.png) |
| 等分の時間割 | [前](before-timetable-1280.png) / [後](after-timetable-1280.png) | [前](before-timetable-390.png) / [後](after-timetable-390.png) |
| メール本文 | [前](before-mail-1280.png) / [後](after-mail-1280.png) | [前](before-mail-390.png) / [後](after-mail-390.png) |

面談は390pxで科目・課題と締切・状況・残りを段に分ける。最小幅544pxで2項目が枠外だった状態から、すべて枠内になった。日時のカードを小さくし、最初の課題の締切が初期表示の画面内に入ることも検査した。課題の選択・詳細の開閉と表の読み上げ用の列見出しは維持した。

学生の週の締切一覧は開始版ですでに枠内だった。390pxでは日付を左、授業名と課題名を右に置いて、日付を先に読めるようにした。時間割の行の等分と7日カレンダーの横移動・日付への移動は維持した。カレンダーの縦表示案は既存の移動操作が使えなくなったため取りやめた（[方針の記録](plan.md#学生の表示方法の更新)）。

手順4からメール本文までは両幅で3回→1回。既存の体験用の準備作成APIを押したときに呼び、本文を開く。失敗時は完了扱いにせず再試行でき、受信箱へ戻った後も同じボタンで本文を開く。「終わった」「後回し」のリンクを押した段階では確認画面を出すだけで、進捗のPOSTがないことを確認した。[変更前の測定](before.json)、[変更後の測定](after.json)。

## 紹介ページの画像

`capture-landing-shots.mjs` で学生685×496・面談1168×667を撮影し、画像の寸法もページ側で更新した。架空の6授業を読み、先生役が締切を11/12 17:00から11/13 17:00へ動かし、LMSを開いた後の両画面を撮った。面談の切り出しには「確かめる／相談する」と締切の表を含めた。囲みは撮影ページにだけ付けた。旧日付の打ち消し線・新日付・両画面の同じ課題を確かめ、格納した画像のSHA-256と寸法を[撮影結果](capture/capture-results.json)と照合した。

撮影ではブラウザを架空の11/9 23:50に固定し、保存した変更の時刻は書き換えていない。撮り直す日のサーバー時刻が固定時刻より後なら撮影スクリプトは停止する。実物のLMS・個人データは使用していない。紹介ページの[1280px](landing/after-people-1280.png)・[390px](landing/after-people-390.png)と、2枚の拡大表示を確認した。

## 検査結果

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：すべて終了コード0。core274・extension509・server324・web221件が成功。既定のserver129・web7件はskip。見本17ファイルが成功し、実物との比較は手元資料がないためskip。
- 既存操作：[28/28、ブラウザ例外0](qa/operations.json)。比較元のIssue #252の28/28を維持。試験の正解と判定は変更していない。
- M6：[8/8（100%）](m6/m6.json)。PLAN.mdの比較元8/8を維持。体験の流れとリセットの試験も成功した。
- `pnpm test:public-demo:browser`：終了コード0。体験の入口・ログイン失敗・締切変更・支援担当の更新・上限の表示・リセットを確認した。
- 紹介ページ：[6章と両幅の表示](landing/chapter-measurements.json)、[動く見本の操作](landing/flow-verification.json)、[拡大と移動](landing/verification.json)、[共用入口](landing-shared/shared-entry.json)が成功。
- 学生：[時間割4ケース](student-fit/after.json)と既存の学生画面の操作が成功。面談：[26操作](session/operations.json)・[8画面](session/after.json)が成功。
- 追加ブラウザ試験：両幅の締切・等分の行・本文まで1回・失敗後の再試行・受信箱からの再表示・確認前の書き込みなしを確認。[検査の記録](artifact-receipt.json)は作者の点検であり、独立レビューは未実施。

エミュレーターの9099・8085ポートが使用中の回は、他の作業者を停止せず空くまで待機した。公開先へのデプロイと実物のGoogleカレンダーへの接続は今回の対象外。[文言の点検](copy-review.md)の別系統での確認は統合役に残す。

## 再実行

`PLAYWRIGHT_MODULE` を手元のPlaywrightの `index.mjs` に設定し、9099・8085ポートが空いていることを確認する。

```sh
ARTIFACT_EVIDENCE_DIR=/tmp/kadai-i261-repeat pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-landing-browser.mjs --small-screens"
ARTIFACT_EVIDENCE_DIR=/tmp/kadai-i261-capture pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-landing-browser.mjs --capture"
```
