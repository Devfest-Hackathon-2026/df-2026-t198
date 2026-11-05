# YNUの見本読み取り：レビュー用記録（2026-11-06）

C02・C03・C07の保存HTML読み取りを実装した。branchは`ynu-reading`。commitはしていない。

## 作ったもの

| 場所 | 内容 |
|---|---|
| `lms-definitions/coursepower/definition.json` | CoursePowerの読み取り定義 |
| `packages/core/src/definition.ts` | 定義の型・実行時検査 |
| `packages/core/src/html-reader.ts` | ページの確認、授業の集約、教材と課題詳細の読み取り、日時変換 |
| `packages/core/src/reading-types.ts` | 観測とは別の中間結果の型 |
| `packages/core/src/linkedom-worker.d.ts` | ブラウザのDOM型をcore全体に足さないための狭い型宣言 |
| `packages/core/tests/definition.test.ts` | 不正な定義の拒否 |
| `packages/core/tests/html-reader.test.mjs` | 既存の正解JSONとの全項目比較、定義の解釈、欠落・不正入力、M1の採点 |
| `packages/extension/tests/html-reader-worker.test.mjs` | ブラウザ向けバンドルを、DOM・Nodeグローバルと動的コード生成がないVMで動かす試験 |
| `scripts/coursepower-samples.mjs` | 架空見本の読み込みと項目単位の比較 |
| `scripts/metrics-m1.mjs` | M1の表示 |

変更したものは、公開入口`packages/core/src/index.ts`、rootとcoreの`package.json`、`pnpm-lock.yaml`、`docs/third-party.md`、`docs/decisions.md` D18、`PLAN.md`。見本のHTML・正解JSON・README、観測の型、`docs/data-shapes.md`、見本検査スクリプトには差分がない。実物の原本は読んでいない。

## 結果

- 完成条件：全体4/36・必須4/31。C02（授業と曜日・時限）、C03（課題）、C07（定義データ）を今回の試験で確認。
- M1：30/30（100%）。教材一覧27/27、詳細3/3。題名・締切・提出状態を各1項目とし、締切は文字列と日時の両方の一致が必要。同じ教材一覧2ファイルを二重に数えていない。
- `typecheck`、`lint`、`build`、`progress --check`：成功。
- core：54試験成功。extension：20試験成功。Webは試験なし。
- server：`listen EPERM: operation not permitted 127.0.0.1`。開始フックがタイムアウトし、4試験を実行できなかった。
- `check:samples`：13ファイル成功。原本に触れないため、変更していない検査スクリプトと見本だけを一時フォルダへコピーし、そこで同名のpnpmコマンドを実行した。原本との照合はしていない。
- `git diff --check`：成功。lockfileは既存の解決結果が変わっていないことと、新規の項目が別の一時フォルダでpnpmに生成させたlockfileと一致することを、YAMLを読んで比較した。

## 実行環境の制約

npmレジストリへの接続は名前解決で失敗した。読み取り専用の既存npmキャッシュから対象の配布物とメタデータを一時フォルダにコピーし、npmのオフライン導入を通した。その依存をcoreのgit管理外の`node_modules`へ置いて試験した。通常のpnpmによる導入と、ネット接続を必要とするlockfileの供給元ポリシー検査は完了していない。

pnpmの自動インストールで既存の`node_modules`を作り直さないよう、この環境での各検証には`pnpm_config_verify_deps_before_run=warn`を指定した。repoの設定は変更していない。たとえばM1の再現コマンドは次のとおり。

```sh
pnpm_config_verify_deps_before_run=warn pnpm metrics:m1
```

通常の接続可能な環境では、レビュー後に`pnpm install --frozen-lockfile`を実行し、依頼された通常のpnpmコマンドを改めて確認する必要がある。

## 未確認と判断

- 対象4見本（home、course-top、assignment-list、assignment-detail-open）に読めなかった項目はない。
- お知らせ2見本はC02・C03の機能の外として未実装。範囲について確認を出したが、記録時点では返答なし。notice-detailの本文では、HTML上のリンク文字が日時より前にあるのに対し、正解JSONは日時を先に置いている。対象を広げる場合は、この順序の根拠も先に確認する。正解は変更していない。
- ログイン・空一覧・終端の印、リンク・次ページは根拠がないので未設定。0行だけで成功にせず、全件取得の完了を宣言しない。取得処理やページ送りは今回の対象外。
- 提出済み詳細の見本は追加していない。一覧の「未評価」の意味は見本READMEの採取記録に限定する。
- VMの試験は、実際のChrome service workerと実物のLMSでの動作証拠ではない。C04以降で確認する。
- 中間結果から観測への変換、API・観測型の変更は行っていない。
