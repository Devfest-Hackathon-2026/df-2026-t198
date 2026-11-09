# Issue #250 の実装と検証の計画

- 読者：初めてToDokuを見る学生・支援担当・審査員。最初の絵で用途を知り、使う人ごとの画面、LMSから変化を取り込む順序を見て、体験版へ進める。
- 根拠：Issue #250、#240のコメント、作業依頼の11/9の指示、rebuild/README.md、penmarkの企業サイトの写し、gui-fix-plan.md。最初の主見出し・補足文・時間割と朝のメールの絵は保持する。
- 構成：トップ → 使う人 → しくみ → 導入 → 情報の扱い → 最後の体験版入口。CSS scroll snapを保つ。体験版の既存の認証・入口を再利用する。
- 変更対象：features/landing/{page.tsx,landing.css,mechanism.tsx,mechanism.css,page.test.tsx}、紹介ページのbrowser試験、PLAN.mdの既存C35の証拠、今回の記録。学生・面談・LMSの機能と共有UIの共通契約は変更しない。
- 図：先生 → LMS → 学生が開いて取り込み → 同じ予定の移動 → 支援担当、各1.8秒で主役を切り替え、最後は5枚の全体像で停止。画面外では開始せず、再訪で再生せず、ボタンで再生。動きを減らす設定は最終状態を静止表示する。通信・保存は行わない。
- 試験経路：依頼で操作と期待値が具体的に決まっているため、直接実装後に独立した要件ベースの試験で確認する。章の順序・各段の大きさ/滞在時間・予定の同一性/移動・replay・reduced motion・通信と保存なしを検査する。既存の高さ/横幅/入口/拡大操作/QA/M6の判定は維持する。
- 確認：6検査、landing.browser.mjs、landing-flow.browser.mjs、landing-chapters.browser.mjs、shared入口往復、審査QA 28/28、M6 8/8、test:public-demo:browser。1280×800と390×844の全章・全段を保存して目視する。
- 文言：短いラベルと状態表示に限る。新しい文言は2候補ずつPRに残し、kuchiguse・yomiyasuとArgonで点検する。Sora・orangeの選択は未確定として明記する。
- 停止条件：範囲外の実装・API/データ/依存の変更・実データ・デプロイが必要になった場合。ポートの競合は他の作業を止めず空きを待つ。最後は作業branchのpush・PR・Issueコメントまで。mergeとデプロイはしない。
