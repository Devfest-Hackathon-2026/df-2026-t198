# Issue #48のREADME確認（2026-11-06）

## 変更と対象

READMEに公開URL、学生と支援担当の操作1〜6、ローカルの3ターミナルでの起動、構成図、Googleサービスを記載した。手動手順の正本をREADMEに移し、docs/demo.mdはそこを参照する。公開用ビルド設定の「画面」への既存の参照を維持した。製品コード・試験の正解・判定基準・依存・API・データ形は変更していない。

## 検証

- 指定の6検査（typecheck、lint、test、build、progress --check、check:samples）はすべて終了コード0。
- 標準のパッケージ試験はcore 129件、extension 96件、web 28件、server 111件成功。web 2件・server 25件は通常実行ではskip。これを通しの試用の証拠にしない。
- `pnpm test:demo:emulator`：Auth・Firestoreのエミュレーターで2ファイル・12件成功。Googleへの実データ送信は行っていない。
- `PLAYWRIGHT_MODULE=<既存のPlaywright> ARTIFACT_EVIDENCE_DIR=/tmp/kadai-i48-evidence pnpm metrics:m6`：終了コード0、8/8（100%）。比較元はPLAN.mdの2026-11-06のローカル・模擬カレンダー8/8で、同条件の今回も8/8。既存のブラウザ試験であり、READMEだけを渡した別系統の試用ではない。
- 上記では学生・支援担当の別ログイン、最初の観測、先生役でLMSだけ変更、観測後の台帳・学生画面・保存済み模擬予定・面談画面の更新、応答喪失後の同じ観測の再送、再取得で重複しないこと、ログアウトを確認した。画像・操作結果・M6は `/tmp/kadai-i48-evidence/`。認証値は記録していない。
- 公開Hostingの `/demo-lms` と `/api/health` は認証なしGETでHTTP 200。公開先のログインや筋書きの成功は確認していない。
- READMEと今回の文書のローカルリンクの存在、既存のREADME内「画面」参照、差分の空白エラーを確認した。文章とサービスの対応は現行コード・設計・デプロイ記録と照合。見本は17ファイル成功、実物との比較は手元の資料がないためskip。fixtures-localは読んでいない。
- M1〜M5・M7は今回未測定。READMEの変更で取得精度・Gemini精度・実LMSの成功率や遅延は評価しない。画面の分かりやすさの人による採点も未実施。

## 残っている確認

C35は未完了のまま。Issueの指定どおりClaudeへREADMEだけでのローカル試用を依頼したが、sendbird cc:rescueの転送は、Claude起点の作業をClaudeへ戻す循環を防ぐため実行を拒否した。指示に従い別経路で再試行していない。既存試験の8/8をこの受入確認の代わりには扱わない。

次の担当はClaude。READMEだけを使い、手元の起動と「ブラウザで試す」1〜6を行い、PRに実測した結果を書く。合格後、同じbranchでC35を[x]にして証拠を書き、`pnpm progress --write`。その後、通常の見直しとCIを経て取り込む。公開先の体験アカウントはIssue #59で準備中で、公開先での通しの確認は別に残る。パスワードはREADME・PR・Issueに書かない。
