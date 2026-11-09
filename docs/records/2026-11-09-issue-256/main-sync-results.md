# main取り込み後の検証結果

main `bcd1e6a`（PR #255、Issue #249）を作業branchに取り込んだ。app.tsxの競合はmainの面談の表示条件を保って単独スライドの2行を加えた。PLANは両Issueの証拠を併記した。しくみの3ファイルと配色は取り込み前から変わっていない。

- 指定6検査：終了コード0。core 274・extension 509・server 319・web 218件成功。通常のunit実行ではserver 129・web 2件skip。見本17ファイル成功。完成条件は全体36/43・必須32/39。
- 審査QA 28/28：[操作](main-sync/qa/operations.json)。
- M6 8/8：[筋書き](main-sync/m6/m6.json)。各runnerは新しいエミュレーターで実行。
- `pnpm test:public-demo:browser`：成功。[確認の要約](main-sync-summary.json)。
- 紹介ページの画像2枚の拡大・既存6ページ・入口と章移動：[確認](main-sync/landing/verification.json)。共用入口の戻る・再入場も両サイズで成功：[確認](main-sync/entry/shared-entry.json)。
- 両サイズの全6段・全操作・6枚の静止図・単独表示：[測定と画像](artifact-main-sync-run/evidence/)、[同じ現物への自己点検](main-sync-receipt.json)。

紹介ページ試験の未ログイン時のナビ照合は、mainに入った#249の「一般の学生には面談を分ける」という了承済み仕様と食い違っていた。常に3リンクを要求する照合を、既存6ページすべてで面談ページは3リンク・一般ページは2リンクの完全一致に更新した。項目の存在確認だけに置き換えず、各ページの見出し・紹介ページからの遷移・拡大操作の確認を保持している。製品の画面制御は変えていない。しくみの6段の基準、M6の8手順・保存数・再送判定も変更していない。

録画はしくみの部品と配色を変更していないため、先の1280×720・31秒のWebM/MP4を維持した。独立したClaudeの見直し、Sora・orangeの文言選択、600行を超える差分への人の合意は未完了。human:okの付与、PRのmerge、デプロイは行っていない。
