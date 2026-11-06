# Issue #59：専用アカウントへの切り替え後の公開先確認

2026-11-06 11:47 JST確認。C31・C33の公開先操作に成功。前回の401による停止は [初回の記録](2026-11-06-issue-59.md)。本記録は再開後の結果で、初回記録の観測・推定は書き換えていない。

## 対象と変更範囲

- 公開先：[模擬LMS](https://project-00439085-4e2d-44c3-9a8.web.app/demo-lms)。Cloud Runの実行アカウントは `kadai-hisho-api@project-00439085-4e2d-44c3-9a8.iam.gserviceaccount.com`、稼働revisionは `kadai-hisho-api-00006-m6t`（100%）。`gcloud run services describe` で再確認し、Hosting経由の `/api/health` は200・`{"status":"ok"}`。
- Issue #59の最新2コメントによると、orchestratorがSoraの許可のもとで専用アカウントを作成し、`roles/datastore.user` と `roles/firebaseauth.viewer` だけを付けて切り替え済み。今回IAM変更・アカウント作成・seed再実行は行っていない。ロールの根拠は当該コメントであり、今回のdescribeは実行アカウントとrevisionの確認。
- `git merge origin/main` でmain `c8ac7ff` を作業branchに取り込んだ（merge `ebf864e`）。公開先は前回反映済みの製品コード `571fbfa` と上記の実行アカウント切り替えによるもの。今回の試験が通ったため、追加デプロイは行っていない。取り込んだmainの後続機能まで公開先で動いたとは扱わない。
- `docs/deploy.md` のCloud Runコマンドに `--service-account` を追加。ビルド用と分けた専用アカウントに、実行に必要な2ロールだけを持たせる理由も記載した。依存・API・データの形・Firestore規則・試験の正解は変更していない。

## 公開先の合格操作

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node packages/web/tests/demo-live.browser.mjs --verify-live-demo
```

既存の公開先試験を変更せずに実行し、終了コード0。拡張機能を入れていない新規Chromium文脈を6つ使い、3組の学生と支援担当を別々にログインさせた。認証情報は許可された `fixtures-local/demo-accounts.local.json` だけを読み、リンク先の権限600も確認した。他のローカル資料は読んでいない。

| 操作 | 結果 |
|---|---|
| 未ログインの `/demo-lms` から3組・6アカウントでログイン | 全件成功。各学生に架空の授業と課題、各支援担当に担当する学生1人だけが表示された |
| 各学生が「LMSを開く」 | 全3組で学生の時間割・授業欄と、別文脈の面談画面に架空の課題が表示された |
| 先生役でtrial-1の締切を1日延長 | 模擬LMSの元データだけが変わり、再取得前の時間割・面談の締切は不変 |
| trial-1で再び「LMSを開く」 | 開いたままの時間割・授業欄と面談の締切が更新。画面では11/9 17:00から11/10 17:00への変更を確認 |
| ほかの2組で再取得 | 元データ・学生の授業欄・面談の締切は操作前と同じ |
| 学生・支援担当から別組の元データと課題への読み取り | 24/24通りが403で拒否された |
| ブラウザの未処理エラー | 0件 |

操作結果：[operations.json](2026-11-06-issue-59/operations.json)。アカウント名・パスワード・UIDを覆った画像も目視した。

- [学生の変更前](2026-11-06-issue-59/student-before.png)
- [学生の変更後](2026-11-06-issue-59/student-after.png)
- [面談の変更後](2026-11-06-issue-59/supporter-after.png)

トークンはメモリだけで扱い、trace・HAR・通信本文・コンソール・生例外は記録しない。認証情報をrepo・Issue・PRや画像に転記していない。別組拒否の確認は体験データと課題に限り、全API・全コレクションの網羅試験とは扱わない。

## 試験・指標と残件

`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` は終了コード0。

- Firestore規則はエミュレーターで38/38成功。通常のパッケージ試験はcore 129件、extension 96件、server 114件、web 28件が成功。server 25件・web 2件のエミュレーター専用試験は通常実行ではskipされるため、実行済みとは扱わない。
- 見本は17ファイル成功。ローカル資料との比較は資料がないためskip。見本の正解・判定基準は変更していない。
- ビルドは成功。Webには既存の500 kB超chunkの警告が残る。今回の公開操作やビルドを失敗させるものではなく、範囲外の改善として残す。
- C31・C33を証拠付きで更新し、`pnpm progress --write` の集計は全体23/41・必須22/37。公開先の保存済み模擬予定など、今回確かめていない条件は完了にしていない。

比較元は初回の公開先試験が最初の観測送信で401となった状態。今回は同じ試験が3組の更新・分離確認まで完走した。M6の固定8手順全体（保存済み模擬カレンダーの移動と応答喪失時の再送を含む）は公開先では未測定のまま。M1〜M5・M7の再測定は、この設定・公開先確認の対象外。

今回完成扱いにするのはC31・C33のみ。C14の独立した保存確認、C34/M6の公開先での全手順、実物のGoogleカレンダー、mainの後続機能の公開反映は今回の証拠に含めない。ClaudeによるPRの見直しとmergeは残る。
