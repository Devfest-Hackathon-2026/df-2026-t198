# Issue #240 作業計画（2026-11-09）

紹介ページを読む学生・支援担当・審査員が、課題の締切が届く流れを見て、共用の体験に入れるようにする。Issue #240 とその追加指示を合格基準とする。既存5 commit と未commitの章試験・撮影記録を引き継ぐ。

- `packages/web/src/features/landing/{page.tsx,landing.css,mechanism.tsx,mechanism.css}`：しくみを架空のHTML/CSSの流れに置き換える。先生のお知らせ、LMS変更、学生の閲覧、取得、時間割とカレンダーの移動、支援担当の更新を約1.2秒ずつ示す。初回表示だけ再生し停止、再生操作、reduced motionの最終静止。
- 同ディレクトリのページとCSS：使う人の画像を並置、体験を主な入口1つと審査用の補助1行にする。導入・情報の章は前任を引き継ぎ、各章の高さと内容の可視性を確かめる。章送りの実装は変更しない。
- `packages/web/tests/{landing.browser.mjs,landing-chapters.browser.mjs,run-landing-browser.mjs,capture-landing-shots.mjs}` と必要なlanding専用試験：6章の高さ・はみ出し、画像拡大、流れの順序・一度だけの再生・停止・再生操作・reduced motion、入口を検査する。古い手動の見本の判定は明示的に廃止された操作だけ置換する。
- `packages/web/public/landing/{student,session}.png`：エミュレーターの架空データで同じ締切変更を撮影し、対応する欄を枠で示す。手順と出力ハッシュを保存する。
- 記録はこのディレクトリ、完成条件の該当があればPLAN.mdの証拠を更新する。新しい完成条件は足さない。

既存の章の高さ超過は引継ぎbeforeの計測を基準とする。自動の流れは新規の明示された操作なので、要件から書いたブラウザ試験で直接検証する。6検査、Auth/Firestoreエミュレーター下のlanding.browser・審査QA 28/28・M6 8/8、1280×800と390×844の全章を保存・目視確認する。文言はkuchiguseの型・yomiyasu・Argonで確認する。

#238・#239は開始時点で未merge。merge後はorigin/mainをmergeし、該当の撮影と試験を再実行する。仕様・API・依存・認証・章送り・他画面を変更しない。前提の矛盾、秘密情報、使用中のポート、別担当の範囲が必要になった場合はその操作を止め、根拠と代案を記録する。pushはこのbranchだけ、PR作成後はClaudeの見直しに渡す。merge・デプロイは行わない。
