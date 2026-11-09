# Issue #250 の検証

対象は紹介ページだけ。`hero-visual.tsx`・主見出し・その下の一文・既存の画面画像を維持し、並びを「トップ → 使う人 → しくみ → 導入 → 情報の扱い → 最後の体験版入口」に変えた。変更する言葉の2候補と人の選択はPRに記載する。

## 試験

[6検査の結果とパッケージ別の件数](checks.json)。

- `pnpm install --frozen-lockfile`：成功。依存・lockfileの変更なし。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：成功。見本17ファイル合格。実物のローカル見本との比較は未実行（読み取り禁止の対象で、作業ツリーにも存在しない）。buildには既存の大きいchunkの警告が残る。
- `landing.browser.mjs`：1280/390、CSS mandatory snap、3行の主見出し、章の入口、初回表示、画像2枚の拡大と閉じる・Esc・背景・フォーカスとスクロール復帰、既存6ルート、ブラウザーエラー0。
- `landing-chapters.browser.mjs`：1280×800・390×844の6章すべてで高さ・内容の可視性・横幅を確認。章の順と次の章へのリンクの順も一致。動きを減らす設定では静止する。
- `landing-flow.browser.mjs`：各段のカードが図全体と同じ大きさで1枚ずつ表示され、1.6〜2秒ずつ進む。先生→LMS→学生が開いて取り込み→同じ予定の移動→支援担当→全体の順序、元の予定要素の維持、カード内の文字と予定枠の収まり、全体での停止・再訪で再生しない・再生ボタン・動きを減らす設定・通信0・保存の変化0を確認。
- `landing-shared.browser.mjs`：両サイズで入口1つから体験用LMSへ入り、戻ってもう一度入る操作を確認。
- 審査QA：28/28、失敗0。既存の学生・面談・LMS・準備の操作の基準は変更していない。
- M6：8/8（100%）。比較元はPLAN.mdのIssue #247のローカル8/8。Auth/Firestoreエミュレーターと体験用カレンダーによる確認で、実物のGoogleカレンダー・公開先は対象外。
- `pnpm test:public-demo:browser`：成功。ログイン失敗の固定表示、入口の往復、LMSだけの変更→学生の読取→面談への反映、共用のお知らせ枠とやり直しを確認。偽の解析のみで、Geminiの実呼び出しなし。

## 試験時に分かったこと

- 初回はcoreのビルド前に単体試験とViteを起動したため、coreのimport解決で停止。coreをビルドしてViteを再起動した。
- 使用中のAuthポートでは起動せず終了し、空いてからやり直した。他の作業者のプロセスは停止していない。
- 審査QAとM6を同じエミュレーターで順に流すと、既存のseedは作成済みアカウントのパスワードを更新せず、各runnerが作る新しい一時パスワードと食い違ってM6のログインで停止した。M6は新しいエミュレーターで単独実行して8/8を確認した。担当外のseedは変更していない。
- 作業中のCSS再読込が図の「通信0」検査に検出された回は不合格として除外した。コードを固定した後の検査は通信0。
- 最初の目視確認で、PCの全体図の予定背景がカードの下へはみ出す箇所を発見。ヘッダーを横に並べ、予定枠を小さくした。判定を強化して予定枠全体も検査し、修正後の同一版で撮り直した。

## 記録の場所

- [計画](intent.md)、[文言の指摘と採否](copy-review.md)
- [各章の高さ](artifact-final-run/evidence/layout/chapter-measurements.json)
- 各章の写し：`artifact-final-run/evidence/layout/after-{章}-{1280|390}.png`
- 各段の写し：`artifact-final-run/evidence/flow/flow-stage-{1..5}-{1280|390}.png`
- 最後の全体：`artifact-final-run/evidence/flow/flow-final-{1280|390}.png`
- [段の順序・時刻・予定の移動](artifact-final-run/evidence/flow/flow-verification.json)
- [共用入口](artifact-final-run/evidence/entry/shared-entry.json)、[拡大と既存の入口](artifact-final-run/evidence/dialogs/verification.json)
- [審査QA](qa.json)、[M6](m6.json)、[体験の通し](demo-flow.json)、[公開体験の検証](public-demo.json)
- [機械検査と目視判断を同じ版に固定した検証票](artifact-receipt.json)。この票は独立した別系統のレビューではない。Claudeの見直し・人の文言選択は未実施。

PLAN.mdのC35に証拠を追記した。完成条件の数字は全体36/43・必須32/39のまま。M1〜M5・M7は取得部品・解析・実運用の検査で、この変更の対象外。merge・デプロイ・実データへの操作はしていない。
