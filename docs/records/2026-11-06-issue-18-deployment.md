# Issue #18の初回デプロイ確認（2026-11-06）

## 対象と合格条件

Issue #18の最新判断に従い、Cloud Run直結とHosting経由の両方で `GET /api/health` がHTTP 200・`{"status":"ok"}` を返すことを確認する。旧 `/healthz` と `/api/healthz` はサーバーから削除する。C14全体の認証済み観測送信・Firestore保存は今回の対象外。

## 公開したもの

- 確認：2026-11-06 09:39 JST。
- プロジェクト：`project-00439085-4e2d-44c3-9a8`、リージョン：`asia-northeast1`。
- ソース：`issue-18` の `85664b9`。再開時に `origin/main` をmerge済み。
- Cloud Build：`b8b0109e-ffea-4640-9cc3-5c6807fc8dc0`、`SUCCESS`。buildpacksでソースからビルドした。
- Cloud Run revision：`kadai-hisho-api-00004-m67`、トラフィック100%。min 0・サービス全体のmax 1・256 MiB・CPU 1。
- Cloud Run：[標準URL](https://kadai-hisho-api-vktixqozoa-an.a.run.app/api/health)、[プロジェクト番号のURL](https://kadai-hisho-api-1029141858245.asia-northeast1.run.app/api/health)。
- Hosting：[公開URL](https://project-00439085-4e2d-44c3-9a8.web.app/student)。`firebase deploy --only hosting` で公開し、Firestoreの規則・索引・データは変更していない。
- Web：既存のWebアプリの公開用SDK設定をFirebase CLIで取得し、3つの `VITE_FIREBASE_*` をビルド時に指定した。値は文書・ログ・commitに記録していない。設定未指定の通常ビルドとはJSの出力が異なる。
- ソースのアップロード一覧は `.gcloudignore` に従い、ルートのビルド設定とcore・serverのソースだけであることを確認した。

## 公開先での確認

Cloud Runの上記2つのURLとHostingで、認証情報を使わずに次を確認した。

| 操作 | Cloud Runの各URL | Hosting |
|---|---|---|
| `GET /api/health` | 200・JSONの `status: ok` | 200・同じJSON |
| `GET /api/health?probe=hosting` | 200・同じJSON | 200・同じJSON |
| `GET /api/healthz` | 404・text/plain | 404・text/plain |
| `GET /api/missing` | 404・text/plain | 404・text/plain（SPAへ流れない） |
| 認証なし `POST /api/v1/observations`、本文 `{}` | 401・`unauthorized`・`Cache-Control: no-store` | 同じ401とヘッダー |

Hostingの `/student` と `/session` は200・text/html。そのHTMLと参照先のJS・CSSは手元の公開用ビルドとバイト単位で一致した。ブラウザでのログイン、画面操作、台帳の表示は未確認。

| 公開ファイル | SHA-256 |
|---|---|
| `/assets/index-C9JnrDJl.js` | f65f38de41988e35766f9305999bec15ec0b38aca9332c4d760bbe07dee49723 |
| `/assets/index-CH-1q0y7.css` | 2b4c25650330e8a4ee8878eb8aa1d0c30f75fd3871657501bbbad136bc444f85 |

## 手元の検査

`pnpm install --frozen-lockfile` の後、指定の6検査を順に実行し、すべて終了コード0。

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples
```

- HTTPの試験は変更前4件失敗・5件成功から、変更後9件成功。新パス、query、旧パスの拒否、別パスと別メソッドの拒否、認証なしの観測の拒否を確認。
- 全体試験：運用55件・Firestore規則32件・画面案6件・M3採点3件・core 123件・extension 47件・web 18件・server 82件成功。web 2件とserver 5件は標準コマンドではskip。
- 見本：17ファイル成功。実物との照合はローカル資料なしのためskip。実物のLMS資料は読んでいない。
- 最初の全体試験は8085番ポートの競合で停止。ほかのプロセスを停止せず、ポートが空いた後の再実行で上記6検査すべて成功。
- 追加の観測APIエミュレーター試験は、JavaのPATHを指定した標準実行を2回行い、どちらも4件成功・同時再送1件が5秒でタイムアウト。診断として `--testTimeout=20000` だけを追加した実行は5件成功（suite全体3.89秒）。標準設定での不安定さは解消したとは扱わず、試験コード・正解・判定基準は変更していない。
- `pnpm progress --write` は全体15/41・必須14/37。C14は未完了のまま、初回公開の証拠だけを追記した。

## 残っていること

- C14：公開先にFirebaseで認証した架空の観測を1件送り、本人の台帳がFirestoreへ保存されることを確認する。
- 追加試験：観測APIの同時再送試験のタイムアウト要因を別途調べる。診断実行の成功だけでは、標準設定で安定したとはいえない。
- ビルド時 `NODE_ENV=development` により開発用依存がコンテナに残る制約は、Issueの再開判断に従って維持。実行時はproduction。手順と理由は [デプロイ手順](../deploy.md)。
- 指標M1〜M7は未測定。このIssueは初回公開と転送の確認であり、取得精度・カレンダー・試用の筋書きの改善は判定しない。
