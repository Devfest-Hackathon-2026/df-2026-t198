# しくみの映像：第2段階の確認

PR #266、Refs #262。配色Bに統一し、研究室・木枠の液晶時計を直した。紹介ページのしくみと単独ページを、5場面・まとめ・ロゴの32.4秒の映像に置き換えた。紹介ページの他章、学生・面談の製品画面のソースは変更していない。merge・デプロイは行っていない。

## 映像と操作

- [全場面の画像と操作結果](film/flow-verification.json)：1280×720、紹介ページ1280×800・390×844の全7場面。入室途中、時計へのズーム、[置時計の拡大](film/consultation-clock-closeup.png)、動きを減らす設定の一覧も保存した。すべての絵はSVGで、ビットマップを製品に追加していない。
- 送信の瞬間、LMSを開く・拡張が読む・ToDokuに記録する・カレンダーが移る順序、支援担当の確認、入室・着席・準備・スマホの振動、翌朝のメールをブラウザで確認した。10:00→10:30の途中が10:15になることも単体試験で確認。
- 前後への移動と往復、一時停止中の経過時間・カメラの維持、再生・最初からの再生、左右キー、横スワイプと縦スクロールの区別、画面外の停止、音の切替を確認。手で場面を選ぶと、その場面の操作後の状態を出す。再生するとその場面の始めから動く。
- [章の寸法](film/chapter-measurements.json)：通常表示と静止一覧が一画面に収まり、横にはみ出さない。全6章も1280/390で確認した。
- 配色の比較操作とA/Cの素材・比較画像を削除した。[素材見本の結果](assets/verification.json)は配色Bだけの9画像。

## 録画

`out/issue-262/mechanism.mp4`（git管理外）。[録画の測定値](recording-proof.json)：1280×720、33.618秒、H.264＋AAC。音の最大値は-27.0 dB、平均は-51.4 dB。全36音符のWeb Audio出力を録音した。動画の冒頭の待ち時間と末尾の静止を含む。

Playwrightの映像には音声が付かないため、同じWeb Audioの出力をMediaStreamDestinationから録音し、ffmpegで合わせた。無音の開始・終了を落とさないよう、値0のConstantSourceも接続した。録音時間33.00秒と経過時間33.12秒を照合し、映像冒頭との差0.56秒を補正。送信音は約1.89秒で始まる。録画フレームと音の開始時刻、最後のロゴまで進むことを確認した。

再現にはビルド済みのpreviewを起動し、手元のPlaywrightを指定する。録画中の開発サーバーの再読み込みを避けるため、ビルドと録画を分ける。

```sh
pnpm --filter web exec vite preview --host 127.0.0.1 --port 5263 --strictPort
# 別の端末。PLAYWRIGHT_MODULEは既存のPlaywrightの入口を指定する。
KADAI_WEB_ORIGIN=http://127.0.0.1:5263 node scripts/record-mechanism.mjs
```

## 試験と残る確認

- 指定6検査が終了コード0：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm progress --check`、`pnpm check:samples`。UTCでも実行。core 274・extension 509・server 324・web 243件成功。server 129件・web 7件は通常の単体試験ではskip。見本の検査は17ファイル成功、実物との比較は行っていない。
- 映像7件＋素材15件＋紹介ページ5件の単体試験、`landing-flow.browser.mjs`、`landing-chapters.browser.mjs`、素材ブラウザ試験が成功。停止中のカメラと、任意移動後の完成した状態も確認。
- `landing.browser.mjs`もUTCで成功。先頭へ戻るスクロールが600ms後も途中（1280でscrollY=390、390でscrollY=449）だったため、scrollY=0を待つ1行を足した。ロゴの位置の合格条件と製品の表示は変更していない。画像の拡大・閉じる操作、リンク、既存の画面への移動も成功。
- [体験の入口](film/shared-entry.json)もUTCの1280/390で成功。各幅でログイン・戻る・再び入る操作を確認した。個別のエミュレーターで実行。
- [画面・操作のQA](qa/operations.json)：28/28。Auth/Firestoreエミュレーターと架空のデータだけを使用した。
- [M6](m6/m6.json)：8/8（100%）。比較元は11/9のIssue #261のローカル8/8。`pnpm metrics:m6`、`pnpm test:public-demo:browser`が終了コード0。実物のGoogleカレンダーは今回の対象外。
- [画面と録画を結び付けた確認記録](phase-2-receipt.json)はpass。これは作成者による現物と試験の確認であり、別系統のPRレビューは未実施。初めて見た人が流れを説明できるかと、動き・音量の好みは人の確認を残す。

新しく満たしたC番号はない。C38は提出用の動画全体と提出先での再生までを求めるため、この部分映像だけでは完了にしない。`pnpm progress --write`後も全体36/43・必須32/39。PLAN.mdには今回のM6の結果だけを追記した。M1〜M5・M7は取得や解析を変更しないため対象外。
