# POL1 全画面の仕上げとスマホ確認

比較元は `066bd5d`（#285〜#288 が入った main）。同じ測定スクリプトで、製品コードを比較元へ一時的に戻した「前」と、差分を戻した「後」を測定した。Auth・Firestore エミュレーターと架空の授業・課題だけを使用した。

390×844 と 360×740 にそれぞれ `hasTouch: true`・`isMobile: true` を指定し、device プリセットは使っていない。各34場面、計68場面を確認した。体験の入口は学生・支援担当の体験ボタンが設定された状態。本人の面談に加え、支援担当による学生の選択、①確かめる、②相談する、保存までを含む。

## 測定結果

合計は同じ操作対象を各場面で測った回数の合計であり、重複のない部品数ではない。

| 項目 | 前 | 後 |
|---|---:|---:|
| ページの横はみ出し（px の合計） | 0 | 0 |
| 44px 未満の的（件） | 426 | 0 |
| 幅2em未満で2行以上になる文字（件） | 0 | 0 |
| 下限未満の本文（件） | 494 | 0 |

後の全場面で上部の帯は56px、重なりは0件。ログイン後の各画面ではログアウトが帯の右に1つある。`body` と `.app-shell` の背景色も一致した。広い週の表とカレンダーは、ページ内に収まった横スクロールの枠で操作できる。「次にやること」の塗りのボタンは幅いっぱい・52px以上。体験の案内は窓の上、窓の中身は70vh。

測定はフォントと有限のアニメーションが落ち着いてから行う。表示中の操作対象を測り、閉じた折りたたみは開いた場面で測る。視覚に出さない読み上げ用の文字は文字幅の測定から除く。本文の下限は12px、時間割のマスの補助だけは9px。判定の閾値や丸めによる許容は加えていない。

各行は「前 → 後」。390の画面名から画像を開ける。機械の生の測定値、上部の帯、スクロール枠の数値、違反した部品の一覧は [mobile-check.json](mobile-check.json) にある。

| 幅 | 画面 | はみ出しpx | 小さい的 | 狭い折り返し | 小さい本文 |
|---:|---|---:|---:|---:|---:|
| 390 | [entry](entry-390.png) | 0 → 0 | 2 → 0 | 0 → 0 | 0 → 0 |
| 390 | [demo-lms](demo-lms-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 390 | [lms-courses](lms-courses-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 390 | [lms-assignments](lms-assignments-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 6 → 0 |
| 390 | [lms-detail](lms-detail-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 390 | [demo-auto-off](demo-auto-off-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 390 | [demo-extended](demo-extended-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 390 | [demo-read-auto-student](demo-read-auto-student-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 390 | [demo-read-auto-supporter](demo-read-auto-supporter-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 390 | [demo-student](demo-student-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 390 | [demo-supporter](demo-supporter-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 390 | [mail](mail-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 390 | [confirmation-before](confirmation-before-390.png) | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 390 | [confirmation-after](confirmation-after-390.png) | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-next](student-next-390.png) | 0 → 0 | 9 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-add-from-next](student-add-from-next-390.png) | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-timetable](student-timetable-390.png) | 0 → 0 | 8 → 0 | 0 → 0 | 12 → 0 |
| 390 | [student-course-detail](student-course-detail-390.png) | 0 → 0 | 11 → 0 | 0 → 0 | 12 → 0 |
| 390 | [student-preparation](student-preparation-390.png) | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-add-plan](student-add-plan-390.png) | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-calendar](student-calendar-390.png) | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 390 | [student-settings](student-settings-390.png) | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 390 | [session-check](session-check-390.png) | 0 → 0 | 6 → 0 | 0 → 0 | 0 → 0 |
| 390 | [session-consult](session-consult-390.png) | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |
| 390 | [session-plan-form](session-plan-form-390.png) | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |
| 390 | [session-saved](session-saved-390.png) | 0 → 0 | 8 → 0 | 0 → 0 | 10 → 0 |
| 390 | [student-plan-detail](student-plan-detail-390.png) | 0 → 0 | 11 → 0 | 0 → 0 | 13 → 0 |
| 390 | [student-active-preparation](student-active-preparation-390.png) | 0 → 0 | 12 → 0 | 0 → 0 | 0 → 0 |
| 390 | [demo-reduced-motion](demo-reduced-motion-390.png) | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 390 | [student-picker](student-picker-390.png) | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 390 | [supporter-check](supporter-check-390.png) | 0 → 0 | 6 → 0 | 0 → 0 | 0 → 0 |
| 390 | [supporter-consult](supporter-consult-390.png) | 0 → 0 | 6 → 0 | 0 → 0 | 10 → 0 |
| 390 | [supporter-plan-form](supporter-plan-form-390.png) | 0 → 0 | 6 → 0 | 0 → 0 | 10 → 0 |
| 390 | [supporter-saved](supporter-saved-390.png) | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |
| 360 | entry | 0 → 0 | 2 → 0 | 0 → 0 | 0 → 0 |
| 360 | demo-lms | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 360 | lms-courses | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 360 | lms-assignments | 0 → 0 | 4 → 0 | 0 → 0 | 6 → 0 |
| 360 | lms-detail | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 360 | demo-auto-off | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 360 | demo-extended | 0 → 0 | 4 → 0 | 0 → 0 | 7 → 0 |
| 360 | demo-read-auto-student | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 360 | demo-read-auto-supporter | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 360 | demo-student | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 360 | demo-supporter | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 360 | mail | 0 → 0 | 4 → 0 | 0 → 0 | 0 → 0 |
| 360 | confirmation-before | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 360 | confirmation-after | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-next | 0 → 0 | 9 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-add-from-next | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-timetable | 0 → 0 | 8 → 0 | 0 → 0 | 12 → 0 |
| 360 | student-course-detail | 0 → 0 | 11 → 0 | 0 → 0 | 12 → 0 |
| 360 | student-preparation | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-add-plan | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-calendar | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 360 | student-settings | 0 → 0 | 10 → 0 | 0 → 0 | 0 → 0 |
| 360 | session-check | 0 → 0 | 6 → 0 | 0 → 0 | 0 → 0 |
| 360 | session-consult | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |
| 360 | session-plan-form | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |
| 360 | session-saved | 0 → 0 | 8 → 0 | 0 → 0 | 10 → 0 |
| 360 | student-plan-detail | 0 → 0 | 11 → 0 | 0 → 0 | 13 → 0 |
| 360 | student-active-preparation | 0 → 0 | 12 → 0 | 0 → 0 | 0 → 0 |
| 360 | demo-reduced-motion | 0 → 0 | 4 → 0 | 0 → 0 | 41 → 0 |
| 360 | student-picker | 0 → 0 | 3 → 0 | 0 → 0 | 0 → 0 |
| 360 | supporter-check | 0 → 0 | 6 → 0 | 0 → 0 | 0 → 0 |
| 360 | supporter-consult | 0 → 0 | 6 → 0 | 0 → 0 | 10 → 0 |
| 360 | supporter-plan-form | 0 → 0 | 6 → 0 | 0 → 0 | 10 → 0 |
| 360 | supporter-saved | 0 → 0 | 7 → 0 | 0 → 0 | 10 → 0 |

## 再実行

ルートで実行する。Playwright が通常のモジュール解決で見つからない環境では、既存のインストール先の `index.mjs` を `PLAYWRIGHT_MODULE` に指定する。依存とCIには追加していない。9099番などエミュレーターのポートが使用中なら、他の実行の終了を待つ。

```sh
pnpm install --frozen-lockfile
pnpm --filter server... build
pnpm exec node scripts/run-emulators.mjs --config-from-env --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --mobile"
```

既定は後の測定と390の撮影で、記録をこのフォルダーに保存する。出力先は `ARTIFACT_EVIDENCE_DIR` で変えられる。`MOBILE_CHECK_PHASE=before` は比較元の製品コードで実行するときだけ指定する。

## 検査

| 検査 | 結果 |
|---|---|
| `pnpm typecheck` / `pnpm lint` | 成功 |
| `pnpm test` | 失敗。webの旧文言の期待値2件が不一致 |
| core / 拡張 / server 単体 | 274 / 555 / 344件成功。serverは別コマンドでも確認 |
| web 単体 / `TZ=UTC pnpm --filter web test` | どちらも286件成功、2件不一致、7件スキップ |
| `pnpm build` / `pnpm progress --check` | 成功。全体37/43、必須33/39 |
| 審査QA | 28/28（[記録](judge-qa.json)） |
| M6 | 8/8。3組・6ブラウザーの分離確認も成功（[記録](m6.json)） |
| `pnpm test:public-demo:browser` | 成功。入口、失敗からの復帰、変更の伝達、上限、リセット |
| スマホの測定 | 68/68。ブラウザーの例外0件 |

指定の `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check` は単体テストで止まったため、buildとprogressは別に実行した。新たなC番号を満たした扱いにはしていない。検査の数字は [validation.json](validation.json) にも残した。

未解決は `student.test.tsx` の24行と111行。現在の期待値は `11/12 · 1件` と `11/10 · 2件` だが、今回指定された表示は `11/12 締切` と `11/10 締切 ほか1件`。「探し方だけ直す」という指示を守るため、この2つの期待値は変更していない。通常とUTCのどちらも、この2件が不一致になっている。表示を旧文言へ戻すと今回の指定に反するため、代案は期待文字列2か所を指定の新文言へ更新すること。

## 既存の試験で変えた探し方

判定のassertや閾値は変更していない。

- `demo-screen.browser.mjs`：削除された画面切り替えの重複ボタンを、同じ役割の既存タブから操作する。
- `demo-reset.browser.mjs` と `judge-qa.browser.mjs`：ログイン後の準備完了を、初期選択のLMSでは表示しなくなった拡大リンクではなく学生タブで待つ。
- `judge-qa.browser.mjs`：準備の一覧を検査する前に折りたたみを開く。並び順、保存内容、操作後の通知、件数などの検査は残す。
- `demo.browser.mjs`・`digest.browser.mjs`・`readme-live.browser.mjs`・`small-screens.browser.mjs`・`todoku.browser.mjs`：メール見本のリンクを、絵文字を外した名前で探す。後回しのリンク名は指定どおり「後回しにする」。

server・拡張・API・データ形式・依存・紹介ページの製品コードは変更していない。メールの文字の変更は見本の表示だけに適用し、送信するHTMLと本文は変更していない。

## POL1b 再開時の確認

既存の `redesign-polish` と未コミットの変更を維持して、Aの検査を再実行した。typecheck・lint・build・progressは成功。審査QAは28/28、M6は8/8、3組6ブラウザーの分離確認と公開体験版のブラウザー試験も成功した。すべてローカルの架空データで、本番には反映していない。

通常・UTCのweb単体試験は、それぞれ286件成功・2件失敗・7件スキップ。上記の旧文言2か所との衝突を再確認した。期待値を指定の新文言へ更新してよいかを質問し、回答待ち。検査成功後にAを先にcommit・push・PR作成する指示に従い、この時点ではいずれも行っていない。Bの測定は再開後には流していないため、上記68場面の数字は前任の記録である。再実行の結果は [resumed-validation.json](resumed-validation.json)、[審査QA](resumed-judge-qa.json)、[M6](resumed-m6.json) を参照。
