# kadai-hisho（課題の秘書・仮称）

status: active

DevFest GDGoC Japan Hackathon 2026 の作品。課題の管理が苦手な大学生と、その学生を支える支援担当（カウンセラーなど）のために、大学の授業支援システムから課題を自動で集め、台帳・カレンダー・面談画面にする。

## 2つのrepo

- 開発は `shieikan/kadai-hisho`（非公開、`origin`）で行う。Issue・PR・CIはこちら。
- 提出用は `Devfest-Hackathon-2026/df-2026-t198`（**公開**、remote名 `submission`）。GitHub ActionsとPagesは使えない。審査はこちらの内容で行う。
- 提出用へは、mainを同じ履歴のままpushする。公開されるので、個人の事情（当事者の経験、カウンセリングの内容、聞き取りのメモ）、実際の課題のデータ、採点の戦略、Creditの情報をどのcommitにも入れない。

## 構成

| 場所 | 中身 |
|---|---|
| `packages/extension/` | Chrome拡張（Manifest V3）。今はYNUのSIDをメモリに受け取る入口のみ |
| `packages/server/` | Cloud Run のAPI。今は `/healthz` のみ。起動は `src/index.ts` |
| `packages/web/` | 学生の画面と支援担当の面談画面（React + Vite、Firebase Hosting） |
| `packages/core/` | 観測・台帳の型と共通関数。DOM・Node固有APIに依存しない |
| `lms-definitions/` | LMS製品ごとの宣言的な定義と試験用の見本 |
| `spikes/` | 確かめるための試作。製品のコードから参照しない |
| `scripts/` | 開発の補助（`plan-progress.mjs`：PLAN.mdの進み具合を数える） |
| `fixtures-local/` | 実物のLMSのページなど、手元だけに置くもの。git管理外 |
| `docs/decisions.md` | 選んだもの・理由・採用しなかった案 |
| `docs/design.md` | 部品のつなぎ目の設計案（状態：案、orangeの合意待ち） |
| `PLAN.md` | 完成条件（C番号）と指標（M番号）、日程の目安。進み具合の正本 |

## コマンド

環境はルートの `package.json` の `engines` と `packageManager` を参照。言語はTypeScript strict。

- 初回：`pnpm install`
- 変更後：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`（全パッケージ）
- 単体：`pnpm --filter <名前> <コマンド>`。名前は `@kadai-hisho/core`、`extension`、`server`、`web`
- ローカル起動とエミュレーターの前提：[README.md](README.md)
- 型の変更：[docs/data-shapes.md](docs/data-shapes.md)。画面の変更：[docs/ui-words.md](docs/ui-words.md) とD13

## 守ること

- mainへ直接pushしない（最初の雛形を除く）。force pushしない。1つのIssueに1つのブランチ。
- 相手の担当範囲（YNUの取得部品：Sora、京大の取得部品：orange）のファイルは変更しない。必要なら変更案をIssueかPRに書いて止まる。
- 依存の追加、技術の変更、データの形やAPIの変更は、人の合意を取ってから行い、理由を `docs/decisions.md` に書く。
- APIキー・秘密情報・LMSの認証情報・Cookie・セッションIDをcommitしない。URLに含まれるセッションIDも記録しない。
- 実物のLMSのページと実際の課題のデータは `fixtures-local/` にだけ置く。commitする見本は、文字と番号を架空のものに置き換えてから `lms-definitions/` に置く。
- サーバーは利用者のLMSのIDとパスワードを持たない。LMSへの書き込み（提出、フォームの送信）はしない。
- Google Cloudのリソースの作成・削除、課金が増える操作は、人に確認してから行う。
- 大会の開始告知（2026-11-05 10:00）より前に書いたコードやPoC（`~/dev/_poc/` や以前の個人用ツールを含む）を入力として渡さない。知見は文書から使う。
- 外部の素材・ライブラリ・データを使ったら、出典とライセンスを `docs/third-party.md` に追記する。
- 完了と言うときは、テストか実際の動作確認の結果を示す。
- PRで完成条件を満たしたら、`PLAN.md` の該当の行を `[x]` にして行末に証拠を書き、`pnpm progress --write` で数字を直す。進み具合を人に伝えるときは `PLAN.md` の「報告の形」で書く。
- 前提が誤っていると判断したら、作業を止めて根拠と代案を返す。
- エージェントがPRをmergeする条件、判断の重さ、止まって人に返すときは [docs/loop.md](docs/loop.md)。大会の決まりと提出物は [docs/submission.md](docs/submission.md)。

## 記録と連絡の置き場所

相手のagentを呼び出せなくても、後から作業する人やagentが続きから始められるように残す。

| 中身 | 置き場所 |
|---|---|
| 人が知るべきこと：決めてほしいこと、止まっていること、進み具合（`PLAN.md` の「報告の形」）、相手に頼みたいこと | Discordの #devfest26。人が読む前提で、略語や内部の番号には説明を添える |
| agentが読めば足りること：作業の経緯、試したことと結果、レビューの指摘、引き継ぎ | GitHubの該当のIssueかPRのコメント。何をしたか、何が残っているか、次に何をするかを書く |
| 決めたこと | Issueか [docs/decisions.md](docs/decisions.md) |
| 進み具合の数字 | `PLAN.md` |
