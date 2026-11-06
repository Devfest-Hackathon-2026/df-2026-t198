# 大会用デプロイ

大会中は、人が許可した範囲でMacから実行する。対象はIssue #18で許可されたプロジェクト。GitHub ActionsからのデプロイやWIFは、この手順では作らない。

## 実行前

repoのルートで作業する。gcloudとFirebase CLIで対象プロジェクトにアクセスできるアカウントへログインしておく。Nodeとpnpmは [package.json](../package.json) の指定を使う。

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples
gcloud meta list-files-for-upload .
```

アップロードするファイルは [.gcloudignore](../.gcloudignore) で限定する。ルートのビルド設定とcore・serverのソース以外が表示されたら止まる。秘密情報、実際の課題、`fixtures-local/` を送らない。

## Cloud Run

```sh
gcloud run deploy kadai-hisho-api \
  --project project-00439085-4e2d-44c3-9a8 \
  --region asia-northeast1 \
  --source . \
  --allow-unauthenticated \
  --min 0 --max 1 \
  --memory 256Mi --cpu 1 \
  --quiet
```

repoのルートをソースにし、buildpacksがコンテナを作る。ルートの `gcp-build` がサーバーをビルドし、`start` が起動する。Cloud Build・Artifact Registry・Cloud RunのAPIと、デプロイ用・ビルド用の権限が必要。権限が足りなければ、自分で広げずに不足をIssueへ記録する。ビルドが失敗したら、原因を記録して止まり、Nodeや依存の指定、ビルド方式を無断で変えない。

Cloud Runの入口は公開する。現段階で返すのは固定のヘルスチェックだけで、台帳は扱わない。利用者のデータを扱うAPIを追加するときは、[design.mdの認証](design.md#4-ログイン認証の仕組みとapiの一覧c04c06c10c14c16c22c26c33) に従ってFirebase ID tokenを検証する。最小インスタンス数は0、最大は1とするが、ビルド・保存・リクエストの費用は発生しうる。

## Hosting

Cloud Runのデプロイが成功してから、ビルド済みのWeb画面を出す。`.firebaserc` の既定値はエミュレーター用なので、対象プロジェクトを毎回明記する。

```sh
pnpm exec firebase deploy --only hosting \
  --project project-00439085-4e2d-44c3-9a8 \
  --non-interactive
```

[firebase.json](../firebase.json) の `/api/**` はCloud Runへ転送する。パスはそのまま届くため、サーバーも `/api/healthz` を受ける。SPA用の `**` は後に置く。Firestoreの規則やデータはこのコマンドでは変更しない。

## 動作確認

```sh
gcloud run services describe kadai-hisho-api \
  --project project-00439085-4e2d-44c3-9a8 \
  --region asia-northeast1 --format='value(status.url)'
# 表示されたURLの後ろに /healthz を付けて、認証なしでGETする。
curl --fail-with-body https://project-00439085-4e2d-44c3-9a8.web.app/api/healthz
```

どちらもHTTP 200で `{"status":"ok"}` が返ることを確認する。Hostingの `/student` と `/session` はWeb画面が表示され、`/api/missing` はHTMLではなく404になることも確かめる。ビルドID・結果・公開URL・確認日時はPRに残す。C14は台帳のFirestore保存までが条件なので、初回デプロイだけでは完了にしない。

公式資料：[Node.js buildpacks](https://docs.cloud.google.com/docs/buildpacks/nodejs)、[ソースからのCloud Runデプロイ](https://docs.cloud.google.com/run/docs/deploying-source-code)、[HostingからCloud Runへの転送](https://firebase.google.com/docs/hosting/cloud-run)。
