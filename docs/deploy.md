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
  --service-account kadai-hisho-api@project-00439085-4e2d-44c3-9a8.iam.gserviceaccount.com \
  --source . \
  --allow-unauthenticated \
  --min 0 --max 1 \
  --memory 256Mi --cpu 1 \
  --update-build-env-vars NODE_ENV=development \
  --update-env-vars NODE_ENV=production,ENABLE_DEMO_ANNOUNCEMENTS=true,GOOGLE_CLOUD_PROJECT=project-00439085-4e2d-44c3-9a8 \
  --quiet
```

repoのルートをソースにし、buildpacksがコンテナを作る。ルートの `gcp-build` がcore、serverの順にビルドし、[Procfile](../Procfile) がNodeを直接起動する。起動時にpnpmを取得・実行するメモリーを避けるためで、ビルド時のpnpmは引き続き使う。Cloud Build・Artifact Registry・Cloud RunのAPIと、デプロイ用・ビルド用の権限が必要。権限が足りなければ、自分で広げずに不足をIssueへ記録する。ビルドが失敗したら、原因を記録して止まり、Nodeや依存の指定、ビルド方式を無断で変えない。

`--service-account` は、作成済みのCloud Run専用アカウントを実行時に使う指定。専用アカウントには、Firestoreの読み書きに必要な `roles/datastore.user`、Firebase Authの利用者・失効状態の確認に必要な `roles/firebaseauth.viewer`（この2つはIssue #59で人が許可）、体験用LMSのお知らせをGeminiで読む `roles/aiplatform.user`（2026-11-07にSoraが許可）の3つだけを付けている。ビルド用の既定アカウントと分け、実行に必要な権限だけを持たせるため、再デプロイでも毎回指定する。この手順ではアカウントの作成やIAMの変更を行わない。

`ENABLE_DEMO_ANNOUNCEMENTS=true` と `GOOGLE_CLOUD_PROJECT` は、体験用LMSの「お知らせを出す」の解析を有効にする設定（[data-shapes.md](data-shapes.md) の体験用データの節）。Cloud Runは `GOOGLE_CLOUD_PROJECT` を自動では入れないので明示する。実物のLMSのお知らせの解析は、この設定でも無効のまま。

ビルド時の `NODE_ENV=development` はbuildpacksの自動pruneを止めるために明記する。pnpm 11.8.0ではルートの `pnpm prune --prod` 後にserverの `firebase-admin` も消え、起動できないことを手元とCloud Runで確認した。初回デプロイは開発用の依存もイメージに残す。実行時の `NODE_ENV` は別に `production` にする。依存を小さくまとめる対応は、この制約を解消する別の作業とする。

Cloud Runの入口は公開する。ヘルスチェックは認証なしで返し、観測APIは [データの形](data-shapes.md) に従ってFirebase ID tokenを検証する。この手順では観測の送信や台帳への書き込みは行わない。最小インスタンス数は0、最大は1とするが、ビルド・保存・リクエストの費用は発生しうる。

## Hosting

Cloud Runのデプロイが成功してから、ビルド済みのWeb画面を出す。`.firebaserc` の既定値はエミュレーター用なので、対象プロジェクトを毎回明記する。

```sh
pnpm exec firebase deploy --only hosting \
  --project project-00439085-4e2d-44c3-9a8 \
  --non-interactive
```

[firebase.json](../firebase.json) の `/api/**` はCloud Runへ転送する。パスはそのまま届くため、サーバーも `/api/health` を受ける。SPA用の `**` は後に置く。Firestoreの規則やデータはこのコマンドでは変更しない。

WebのFirebase接続設定は [README](../README.md#画面) の3つの `VITE_FIREBASE_*` をビルド時に指定する。未指定でビルドした場合も公開できるが、学生・面談画面は準備中の案内になり、ログインや台帳の表示はできない。今回の初回デプロイの合格条件は、画面と静的ファイルへの到達およびAPIへの転送まで。

## 動作確認

```sh
gcloud run services describe kadai-hisho-api \
  --project project-00439085-4e2d-44c3-9a8 \
  --region asia-northeast1 --format='value(status.url)'
# 表示されたURLの後ろに /api/health を付けて、認証なしでGETする。
curl --fail-with-body https://project-00439085-4e2d-44c3-9a8.web.app/api/health
```

どちらもHTTP 200で `{"status":"ok"}` が返ることを確認する。Hostingの `/student` と `/session` はWebのHTMLを返し、そのHTMLが参照するJS・CSSも取得できること、`/api/missing` はHTMLではなく404になることも確かめる。Cloud RunとHostingの両方で、認証なしの `POST /api/v1/observations` が401になることを確かめる。ビルドID・結果・公開URL・確認日時はPRに残す。C14は台帳のFirestore保存までが条件なので、初回デプロイだけでは完了にしない。

確認のパスはIssue #18の再開判断に従って `/api/health` に統一する。旧 `/healthz` と `/api/healthz` は提供しない。Cloud Runの予約パスとの衝突を避けるため、末尾にzを付ける案は採らない。

公式資料：[Node.js buildpacks](https://docs.cloud.google.com/docs/buildpacks/nodejs)、[Procfile](https://docs.cloud.google.com/docs/buildpacks/about-procfile)、[ソースからのCloud Runデプロイ](https://docs.cloud.google.com/run/docs/deploying-source-code)、[HostingからCloud Runへの転送](https://firebase.google.com/docs/hosting/cloud-run)。
