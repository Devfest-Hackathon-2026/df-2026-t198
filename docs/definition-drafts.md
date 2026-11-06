# 読み取り方の下書きを作る

開発担当が、架空のHTMLから定義の案を作り、読み取り結果と見比べて取り込むための手順。自動で有効化する処理はない。実物のLMSのHTMLは送らない。

## 生成

既存の大会用プロジェクトのVertex AIを呼べるApplication Default Credentialsを使う。鍵の発行や資源の作成は、このコマンドでは行わない。

```sh
GOOGLE_CLOUD_PROJECT=<許可済みのプロジェクトID> pnpm definition:draft lms-definitions/demo-lms/draft-input.json demo-lms
```

第1引数はHTMLの束を指定するJSON、第2引数は定義のID。JSONの各行には `file`（repoのルートからのHTMLのパス）と `context`（`utcOffset`、必要な `courseId`・`sourceId`）を書く。[模擬LMSの例](../lms-definitions/demo-lms/draft-input.json) を参照。別製品の見本も `lms-definitions/<名前>/` に架空の内容として置く。見本の正解は変更しない。

入力は `lms-definitions/` 内の通常ファイルに限る。リンク・範囲外のパス・`fixtures-local` は拒否する。認証情報らしい既知の文字列も拒否するが、個人情報を完全に検出するものではない。実データを匿名化したつもりで渡さず、最初から架空の見本を使う。

Geminiに渡すのはHTML、読み取りの文脈、既存の型の書式だけ。既存の定義や試験の正解は渡さない。返答を `validateDefinition` で検査し、通ったものを `out/definition-drafts/<ID>/definition.draft.json` に保存する。同名の出力フォルダがあれば呼び出す前に止まり、上書きしない。`review.json` には下書き・各HTMLのハッシュ・読み取り結果・APIの回数・生成のトークン数・計数と生成の所要時間をまとめる。これらはgit管理外。

## 確認と取り込み

1. `definition.draft.json` と `review.json` をエディターで開く。各ページの種類、授業と曜日・時限、課題のID・題名・締切・提出状態を見本と照合する。`reading-failed` があれば取り込まず、原因を直して読み直す。型の検査を通っただけでは、値の意味が正しいとは限らない。
2. 模擬LMSの下書きは、次で既存の読み取り試験と同じ5件を通す。このコマンドはGeminiを呼ばず、試験の正解も書き換えない。一時的な試験ファイルで、読み込む定義のパスだけを置き換える。

   ```sh
   pnpm definition:check out/definition-drafts/demo-lms/definition.draft.json
   ```

3. 別製品では、その製品の見本と人が先に決めた正解で同じように試験する。今回の確認コマンドの対象は模擬LMSだけ。ログイン切れやページ送りなど、見本に無い動作の正しさは未確認。
4. 人が確認したら、下書きの写しを `lms-definitions/<名前>/definition.json` に改名してPRに含める。既存の定義がある場合は差分を見てから更新する。模擬LMSの実測だけのために既存定義を置き換える必要はない。
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` を通す。採用は通常のPRの見直しを経て行う。

## 呼び出しと上限

承認済みのGoogle Gen AI SDKを使用する（出典・ライセンスは [third-party.md](third-party.md)）。SDKのVertex AI対応を使い、独自の認証やエージェント基盤は追加しない。[公式SDK](https://github.com/googleapis/js-genai) を確認した上で、既存の読み取り器に渡すJSONを作る部分だけを実装した。

1コマンドにつきトークンの計数1回と生成1回、再試行なし、各呼び出しの待ち時間120秒。HTMLは最大12件・各20,000バイト、指示を含むUTF-8のバイト数＋余裕1,024で24,000まで、出力は推論込み4,096トークンまで。SDKの `countTokens` に同じ入力とシステム指示を渡し、返された数＋余裕128と最大出力を予約する。計数失敗時は生成しない。

費用を送信前に予約し、応答のusage（推論込み）で精算する。同じMac・プロジェクトのM3用の予算ファイルを共有して1日3,000円を上限とし、C30専用の予算ファイルでも最初の成功時のトークン数の3倍を以後の上限にする。M3側の既存の実測上限も適用する。最大出力まで予約するため、実際には収まりそうな入力でも止まる場合がある。失敗やusage不明の呼び出しは予約を残す。未送信の停止でもC30側に予約が残る場合がある。

予算の保存先は `~/.cache/kadai-hisho/{m3,definition-drafts}/<プロジェクト>/usage.json`。複数のMacや他のコマンドの支出全体を集約するものではない。概算は既存の予算部品と同じく[標準単価](https://cloud.google.com/model-garden/pricing)と200円/USDで計算する。SDKの例外や不正な応答の本文は表示・保存しない。
