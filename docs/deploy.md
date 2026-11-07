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
  --update-env-vars NODE_ENV=production,ENABLE_DEMO_ANNOUNCEMENTS=true,GOOGLE_CLOUD_PROJECT=project-00439085-4e2d-44c3-9a8,PUBLIC_WEB_ORIGIN=https://project-00439085-4e2d-44c3-9a8.web.app \
  --quiet
```

repoのルートをソースにし、buildpacksがコンテナを作る。ルートの `gcp-build` がcore、serverの順にビルドし、[Procfile](../Procfile) がNodeを直接起動する。起動時にpnpmを取得・実行するメモリーを避けるためで、ビルド時のpnpmは引き続き使う。Cloud Build・Artifact Registry・Cloud RunのAPIと、デプロイ用・ビルド用の権限が必要。権限が足りなければ、自分で広げずに不足をIssueへ記録する。ビルドが失敗したら、原因を記録して止まり、Nodeや依存の指定、ビルド方式を無断で変えない。

`--service-account` は、作成済みのCloud Run専用アカウントを実行時に使う指定。専用アカウントには、Firestoreの読み書きに必要な `roles/datastore.user`、Firebase Authの利用者・失効状態の確認に必要な `roles/firebaseauth.viewer`（この2つはIssue #59で人が許可）、体験用LMSのお知らせをGeminiで読む `roles/aiplatform.user`（2026-11-07にSoraが許可）の3つだけを付けている。ビルド用の既定アカウントと分け、実行に必要な権限だけを持たせるため、再デプロイでも毎回指定する。この手順ではアカウントの作成やIAMの変更を行わない。

`ENABLE_DEMO_ANNOUNCEMENTS=true` と `GOOGLE_CLOUD_PROJECT` は、体験用LMSの「お知らせを出す」の解析を有効にする設定（[data-shapes.md](data-shapes.md) の体験用データの節）。Cloud Runは `GOOGLE_CLOUD_PROJECT` を自動では入れないので明示する。実物のLMSのお知らせの解析は、この設定でも無効のまま。

`PUBLIC_WEB_ORIGIN` は、今日やることのメールに入れる学生画面のリンク先。上のHostingの公開先を指定する。未設定では `GET /api/v1/digest` が503を返し、体験用LMSの「今朝のメール」も表示できない（ほかのAPIは起動する）。旧拡張のメール送信は、別Issueで切り替えるまで維持する。Issue #162のクラウド送信の準備は末尾を参照。

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

WebのFirebase接続設定は [README](../README.md#画面) の3つの `VITE_FIREBASE_*` をビルド時に指定する。未指定でビルドした場合も公開できるが、学生・面談画面は準備中の案内になり、ログインや台帳の表示はできない。ログイン後の操作は、次節の体験手順で別に確かめる。

## 動作確認

```sh
gcloud run services describe kadai-hisho-api \
  --project project-00439085-4e2d-44c3-9a8 \
  --region asia-northeast1 --format='value(status.url)'
# 表示されたURLの後ろに /api/health を付けて、認証なしでGETする。
curl --fail-with-body https://project-00439085-4e2d-44c3-9a8.web.app/api/health
```

どちらもHTTP 200で `{"status":"ok"}` が返ることを確認する。Hostingの `/student` と `/session` はWebのHTMLを返し、そのHTMLが参照するJS・CSSも取得できること、`/api/missing` はHTMLではなく404になることも確かめる。Cloud RunとHostingの両方で、認証なしの `POST /api/v1/observations` が401になることを確かめる。ビルドID・結果・公開URL・確認日時はPRに残す。C14は台帳のFirestore保存までが条件なので、初回デプロイだけでは完了にしない。

更新後は [READMEの「ブラウザで試す」](../README.md#ブラウザで試す) の1〜6を、学生・支援担当の別ブラウザで最後まで通す。最後に体験をリセットし、両方でログアウトする。メール見本の確認を実際のGmailへの配信成功とは扱わない。

確認のパスはIssue #18の再開判断に従って `/api/health` に統一する。旧 `/healthz` と `/api/healthz` は提供しない。Cloud Runの予約パスとの衝突を避けるため、末尾にzを付ける案は採らない。

公式資料：[Node.js buildpacks](https://docs.cloud.google.com/docs/buildpacks/nodejs)、[Procfile](https://docs.cloud.google.com/docs/buildpacks/about-procfile)、[ソースからのCloud Runデプロイ](https://docs.cloud.google.com/run/docs/deploying-source-code)、[HostingからCloud Runへの転送](https://firebase.google.com/docs/hosting/cloud-run)。

## 専用Gmailの通知準備（Issue #162、実行はorange）

以下は未実行の手順。A1は仮採用で、orangeがD36案を確定してから実行する。資源・課金・権限・送信をこのPRで許可したとは扱わない。既定は送信無効。拡張の停止と移行状態の確定は別Issueで行う。

1. プロダクト専用のGoogle/Gmailアカウントを作る（個人用と分ける）。復旧手段を管理する。以後の同意ではこの送信元だけにログインする。
2. 下記の画面でGmail APIを有効にし、Google Auth Platformの同意画面をExternal/Testingにする。テストユーザーは送信元1アカウントだけ。Web applicationのOAuthクライアントを作り、redirect URIに `https://developers.google.com/oauthplayground` を登録する。クライアントを拡張と共用しない。

```sh
KADAI_PROJECT=project-00439085-4e2d-44c3-9a8
open "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=$KADAI_PROJECT"
open "https://console.cloud.google.com/auth/overview?project=$KADAI_PROJECT"
open 'https://developers.google.com/oauthplayground/'
```

3. Playgroundの歯車で「Use your own OAuth credentials」を選び、自分のclient ID/secretを入力。scopeを `https://www.googleapis.com/auth/gmail.send` だけにする。offline・consentを指定して送信元で同意し、authorization codeをtokenへ交換する。Playground既定のclientは使わない。refresh tokenをブラウザ・通常ログ・会話へ写さず、次の非表示入力に渡す。実送信の試行はまだしない。
4. 同意した日時（timezone付き）だけを非公開の運用記録に残し、7日後を計算する。Testingのrefresh tokenは7日で失効する。交換結果に `refresh_token_expires_in` があれば、その短い方も確認する。下の判定は11/15 00:00 JSTを越えることを確認するもので、11/15終日を保証しない。必要な稼働終了時刻がそれより遅ければ比較日時をorangeが先に決める。

```sh
python3 - <<'PY'
from datetime import datetime, timedelta
consent = datetime.fromisoformat(input('実際の同意日時 (例の形式 YYYY-MM-DDTHH:MM:SS+09:00): '))
assert consent.utcoffset() is not None
expiry = consent + timedelta(days=7)
print('7日後:', expiry.isoformat())
assert expiry > datetime.fromisoformat('2026-11-15T00:00:00+09:00'), '期限が不足。切替を止める'
PY
```

11/10の締切後から11/14までは、手動再認可・secret版変更・再デプロイをしない（D35）。7日は失効しない保証ではなく、取消やパスワード変更等でも失効する。期限が不足するなら凍結前に再同意し固定版を更新するか、クラウドへの切替を止める。締切後に手でつなぎ直す案は採らない。

5. repo外の権限制限した一時ファイルからSecret Managerへ登録する。次は新規secret・version 1の例。既存の場合は上書きせず新しい版を作り、番号を確認して後段の数字も合わせる。secretを表示するコマンドは使わない。

```sh
umask 077
KADAI_SECRET_DIR=$(mktemp -d)
python3 - "$KADAI_SECRET_DIR" <<'PY'
import getpass, pathlib, sys
root = pathlib.Path(sys.argv[1])
for name in ['gmail-client-id', 'gmail-client-secret', 'gmail-refresh-token']:
    value = getpass.getpass(name + ' (非表示): ')
    assert value and '\n' not in value
    (root / name).write_text(value)
PY
for KADAI_SECRET in gmail-client-id gmail-client-secret gmail-refresh-token; do
  gcloud secrets create "$KADAI_SECRET" --project "$KADAI_PROJECT" \
    --replication-policy=automatic --data-file="$KADAI_SECRET_DIR/$KADAI_SECRET"
  gcloud secrets add-iam-policy-binding "$KADAI_SECRET" --project "$KADAI_PROJECT" \
    --member="serviceAccount:kadai-hisho-api@$KADAI_PROJECT.iam.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
rm "$KADAI_SECRET_DIR/gmail-client-id" "$KADAI_SECRET_DIR/gmail-client-secret" "$KADAI_SECRET_DIR/gmail-refresh-token"
rmdir "$KADAI_SECRET_DIR"
```

6. 上の通常のCloud Runデプロイが通る版に、secretの**数字の固定版**を結び付ける（latestは使わない）。送信元は実際の専用Gmailの裸のアドレス1つを入力。送信元とOAuthのアカウントが同じことをorangeが確認する。APIはそのアドレスの `/users/{from}/messages/send` へ送るため、別の送信元をリクエストで選べない。

```sh
KADAI_API_ORIGIN=$(gcloud run services describe kadai-hisho-api --project "$KADAI_PROJECT" \
  --region asia-northeast1 --format='value(status.url)')
KADAI_SCHEDULER_SA="notification-scheduler@$KADAI_PROJECT.iam.gserviceaccount.com"
read 'KADAI_FROM?専用Gmailのアドレス: '
gcloud iam service-accounts create notification-scheduler --project "$KADAI_PROJECT"
gcloud run services update kadai-hisho-api --project "$KADAI_PROJECT" --region asia-northeast1 \
  --update-secrets=GMAIL_CLIENT_ID=gmail-client-id:1,GMAIL_CLIENT_SECRET=gmail-client-secret:1,GMAIL_REFRESH_TOKEN=gmail-refresh-token:1 \
  --update-env-vars="NOTIFICATION_FROM=$KADAI_FROM,NOTIFICATION_SEND_ENABLED=false,NOTIFICATION_OIDC_AUDIENCE=$KADAI_API_ORIGIN,NOTIFICATION_SCHEDULER_SERVICE_ACCOUNT=$KADAI_SCHEDULER_SA"
gcloud scheduler jobs create http notification-tick --project "$KADAI_PROJECT" --location asia-northeast1 \
  --schedule='* * * * *' --time-zone=Asia/Tokyo --http-method=POST \
  --uri="$KADAI_API_ORIGIN/api/internal/notifications/tick" \
  --oidc-service-account-email="$KADAI_SCHEDULER_SA" --oidc-token-audience="$KADAI_API_ORIGIN" \
  --max-retry-attempts=0 --attempt-deadline=180s
```

Cloud Scheduler APIとサービスエージェントの `roles/cloudscheduler.serviceAgent`、実行者の対象SAへのactAs権限を確認する。不足はorangeに返し、プロジェクト全体のOwner等を追加しない。Cloud Runは公開入口なので、内部tickはアプリでOIDCを検証する。Scheduler用SAのtoken発行権限を他の利用者へ広げない。Schedulerの本文・queryでUID・時刻・有効フラグを指定しない。

7. falseのままtickのdry-run・未認証401・不正OIDC401を確認する。設定画面は準備中となり、有効化を拒否する。secretの存在だけを「接続済み」「受信済み」と扱わない。orangeの実送信確認の段階でのみ、以下を実行する。

```sh
gcloud run services update kadai-hisho-api --project "$KADAI_PROJECT" --region asia-northeast1 \
  --update-env-vars=NOTIFICATION_SEND_ENABLED=true
```

このフラグだけでは、移行前（owner none/extension、migrationState not-started）の本人は送信対象にならない。別Issueで旧拡張停止・対象者・戻し方を確認してowner cloud/migrationState readyとし、本人が通知を有効にする。古い拡張との二重送信を避けるため、本手順に移行状態を直接書き換えるコマンドは含めない。11/9 18:00までにAC-02/03の実受信が通らなければ切替を止める（#152）。

自然時刻の朝と準備前で、予定時刻・処理開始・API受理・本人Gmailの受信を別々に記録する。PC/Chromeを閉じた条件、停止、失効、結果不明も確かめる。Gmailの401/403は接続のやり直し、429は未受理、5xx/応答喪失/不完全な成功応答は結果不明。いずれも送信POSTを自動再送しない。invalid_grant等で止まった送信元は、凍結前に再同意・固定版更新・revision更新で復旧する。

公式資料：[Gmail送信API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)、[エラー](https://developers.google.com/workspace/gmail/api/guides/handle-errors)、[offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline)、[Testingの7日期限](https://developers.google.com/identity/protocols/oauth2#expiration)、[Cloud Runのsecret](https://docs.cloud.google.com/run/docs/configuring/services/secrets)、[SchedulerのOIDC](https://docs.cloud.google.com/scheduler/docs/http-target-auth)。
