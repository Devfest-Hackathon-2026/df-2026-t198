# main取り込み後の確認計画（2026-11-09）

PR #243でSoraの判断により#239が取り消され、章送りはCSSのscroll snapへ戻った。同PRは「章を1画面に収める#240で様子を見る」としている。この新しい前提を維持し、紹介ページの内容・高さ・しくみの図を保持してmainを取り込む。

- `landing/page.tsx`：mainで廃止されたsettleChaptersの参照・起動・後始末を除く。章送りの別実装は加えない。
- `landing/landing.css`：mainのmandatory snap・章のstart・reduced motionのnoneを保持し、今回の配置と余白を保持する。
- mainが削除したchapter-scrollのブラウザ試験を削除のまま受け入れ、landing用runner・検証契約から外す。既存のlandingブラウザ試験でCSSのsnapと6章のstartを確かめる。図・拡大・入口の条件は変更しない。
- #242の審査リンクとPLAN・文言の追記を保持する。認証・他の画面のファイルはmergeで受け取るだけで直接変更しない。
- 6検査、Auth/Firestoreエミュレーターでlandingの4検査・QA 28/28・M6 8/8を再実行。6章×2サイズ・図と入口の写しをこの記録に保存し、前の検証記録と混ぜない。製品画像は#243が影響しない学生・面談のものなのでハッシュで維持を確かめる。
- PR本文・Issueの引継ぎを現在の前提へ更新する。merge・デプロイ・human:ok付与は行わない。
