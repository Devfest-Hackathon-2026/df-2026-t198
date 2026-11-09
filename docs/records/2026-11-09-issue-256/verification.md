# Issue #256 検証記録

## 対象

main `5d35347` からの `issue-256-mechanism-slides`。紹介ページのしくみを6段・各約5秒のスライドと独自HTML/SVGへ変更。既存SPAへの単独ページの接続だけ `app.tsx` に2行追加した。依存・API・データ・LMS取得部品は変更していない。

## 検査

- `pnpm install --frozen-lockfile`：成功。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：終了コード0。core 274、extension 509、server 319、web 214件成功。通常のunit実行ではエミュレーター専用などserver 129・web 2件をskip。見本17ファイル成功。`fixtures-local/` は読んでいない。
- 新規の録画スクリプトは `node --check` と `pnpm exec eslint scripts/record-mechanism.mjs` でも確認。
- 審査QA 28/28、M6 8/8、`pnpm test:public-demo:browser`、紹介ページの拡大・入口・既存経路、共用入口の往復：すべて成功。ブラウザの結果と画像は下の記録を参照。公開先・実LMS・実Googleカレンダーは対象外。M6の比較元はPLANのローカル8/8、今回も8/8。
- 完成条件はC35の紹介ページの証拠を追加する。全体36/43・必須32/39は変わらない。しくみの録画は説明用素材であり、C38の実操作の提出動画・C42のスライド提出の完了とは扱わない。

## 確認した操作

- 両サイズの6段・約5秒、同一の課題カードと同一のカレンダーの予定、締切変更→LMS閲覧→取り込み→両予定の移動→面談の印→翌朝のメールの順。
- 前へ・次へ・一時停止・再開・最初から、章にフォーカスがあるときの矢印キー、横スワイプ、縦スクロールの維持。
- 画面外・hover・本人の操作後の停止、最後の段での停止。手動で最後へ進んだ場合にも最初からを表示。
- aria-liveの説明・名前のあるボタン・48px以上のボタン。
- 動きを減らす設定では6枚を静止表示し、両サイズで章を1画面に収める。紹介ページの他章・入口・拡大操作も維持。
- 単独表示 `/slides/mechanism`：クエリなしは停止、`?autoplay=1` は全6段を自動再生。1280×720の構図を画面に合わせて縮小し、狭い画面でも16:9を維持。

## 画像・文言・録画

- [審査QA](qa/operations.json)、[M6](m6/m6.json)、[ブラウザ試験の要約](browser-summary.json)、[紹介ページの操作](landing/verification.json)、[共用入口](entry/shared-entry.json)。
- 最終画面と測定：`artifact-review-run/evidence/`。各サイズの全6段、静止図6枚と全体、単独表示、各章の写し。
- 文言の指摘と採否：[copy-review.md](copy-review.md)。候補はPR本文。
- 録画：`scripts/record-mechanism.mjs` をビルド済み画面に対して実行。git管理外の `out/issue-256/mechanism.webm` と `out/issue-256/mechanism.mp4` に保存した（1280×720、31秒）。各段の抜き出しは `video-frames/`。

## 検証中の失敗と扱い

初回のunit試験でSSR時の `document` 参照が失敗し、ガードを追加して再検査した。手動で最終段へ進んだ場合の再生ボタンが無いことを実画面で確認し修正した。狭い単独ページで16:9が崩れることを実測し、全体を縮小する構成へ直した。

審査QAとM6を同じエミュレーターへ続けて流した回は、既存seedが作成済みアカウントのパスワードを更新せず停止した。各runnerを新しいエミュレーターで分けて再実行し、成功した。担当外のseedは変更していない。HMRによる中断、試験側のTouchInit不足・React反映待ち不足の回は合格記録に含めない。

## 残る判断

表示中の文言と候補の選択はSora・orange、実装の見直しはClaudeへ渡す。600行を超える差分への人の合意は本作業では取得しておらず、human:okは付けない。merge・デプロイは実行していない。

段の間隔の実測は1280pxで5001〜5011ms、390pxで4997〜5010ms。反復検証の[receipt](receipt.json)はCodexの自己点検と同じ現物の対応を示すもので、独立レビューの承認ではない。
