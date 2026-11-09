# Issue #240 main反映後の確認（2026-11-09）

PR #242（審査リンク）・#243（CSSスナップへの復帰）を含むmain `ba37afb` をmergeした。#243には、Soraが前の章送りを選び、「章を1画面に収める#240で様子を見る」とあるため、mainのCSSスナップを保持して今回の章の内容を合わせた。

競合は、ページのHeroVisual・Mechanismと1画面の配置を保持し、mainが廃止した自前の章送りの参照を除いて解消した。mainで削除された章送りの実装・単体試験・ブラウザ試験は復活させていない。審査リンクのコードと記録も保持した。学生・面談・認証・サーバー・拡張・coreへ直接の修正は加えていない。

## 検証

- 指定の6検査：すべて終了0。core 274、extension 509、web 211、server 312件成功。web 2、server 128件は既定の条件によりskip。mainから入った審査リンクのスクリプト試験4件も成功。見本17ファイル成功、実物との比較は対象外。
- `landing-chapters.browser.mjs`：1280×800・390×844の6章すべて、章の高さ＝画面の高さ、内容の可視性、横にはみ出さないこと、入口1つ、LMS一覧1校、注意の4項目、動きを減らす設定の最終静止を確認。[結果](2026-11-09-issue-240-main-sync/chapter-measurements.json)。
- `landing-flow.browser.mjs`：両サイズで約1.4秒ごとの順序、LMSだけの変更→読み取り後の同じ予定の移動→支援担当、途中のx座標、一度だけの再生、再入場での停止、再生操作、動きを減らす設定、図による通信・保存の変化なしを確認。[結果と写し](2026-11-09-issue-240-main-sync/flow/)。
- `landing-shared.browser.mjs`：両サイズで共用の1ボタン、画面内の位置、入る→戻る→再操作が成功。[結果と写し](2026-11-09-issue-240-main-sync/entry/)。未設定ビルドでは体験用LMSリンクを確認した。
- `landing.browser.mjs`：エミュレーターありで終了0。画像2枚の拡大・閉じる・Esc・背景・フォーカスとスクロール復帰、既存6ページ、初回表示を確認。通常時は `scroll-snap-type: y mandatory`、6章は `scroll-snap-align: start`、動きを減らす設定ではsnapなしを確認。[結果](2026-11-09-issue-240-main-sync/verification.json)。取り込みで戻った試験の固定ポート指定は、runnerが起動した接続先を環境から使う形へ戻した。操作・判定は緩めていない。
- 審査QA：[28/28、ブラウザ例外0](2026-11-09-issue-240-main-sync/judge-qa.json)。M6：[8/8（100%）](2026-11-09-issue-240-main-sync/m6.json)。[体験の流れ](2026-11-09-issue-240-main-sync/demo-flow.json)・[リセット等](2026-11-09-issue-240-main-sync/demo-reset.json)も成功。

Auth/Firestoreエミュレーター・Chromium・架空データで実行し、QAとM6はそれぞれ新しいエミュレーターで確認した。公開先・実物Googleカレンダー・実LMSは今回未測定。画像撮影の手順と囲みは [元の記録](2026-11-09-issue-240.md#製品画像の撮影) を参照する。

## 画面と記録

6章×2サイズの写しを撮り直し、既に目視確認した [afterの12枚](2026-11-09-issue-240/after/) とすべてSHA-256が一致したため、その画像を参照する。[対応とハッシュ](2026-11-09-issue-240-main-sync/layout-image-hashes.json)。学生・支援担当の製品画像も撮影時のハッシュを維持している。

[追加の計画](2026-11-09-issue-240-main-sync/plan.md)と[検証契約](2026-11-09-issue-240-main-sync/artifact-contract.json)に沿って再実行し、目視確認と同じファイルを結び付けた [receipt](2026-11-09-issue-240-main-sync/artifact-receipt.json) はpass。実装者自身の確認であり、独立レビューではない。

[最初の記録](2026-11-09-issue-240.md)の#239の自前の章送りに関する結果は、その時点の記録として保持する。今回の引渡しは本記録のCSSスナップ版。PRには同じ主見出し下の一文・章名の候補と、[文言の採否](2026-11-09-issue-240/copy-review.md)を示す。人の文言選択と、600行超の合意、Claudeの見直し・merge判断は残る。共用ログイン失敗時の既存の旧「動く見本」への参照は担当外で変更していない。
