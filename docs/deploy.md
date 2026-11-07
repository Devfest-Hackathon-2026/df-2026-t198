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

`PUBLIC_WEB_ORIGIN` は、今日やることのメールに入れる学生画面のリンク先。上のHostingの公開先を指定する。未設定では `GET /api/v1/digest` が503を返し、体験用LMSの「今朝のメール」も表示できない（ほかのAPIは起動する）。メール送信は本人が有効にしたChrome拡張が行うため、Cloud RunにGmailの送信権限や送信トークンは置かない。

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

## 拡張のメールからクラウド通知へ移す（Issue #163）

実行者はorange。以下は手順の記述で、切替を実行した記録ではない。#162の送信元接続とクラウドから本人への実受信（朝・準備前）が通るまで、cloudを有効にしない。11/9 18:00の打ち切りと凍結期間は #152 と [提出の決まり](submission.md) に従う。LMS取得とカレンダー同期は拡張に残す。

### 切替前の確認

- 本人のUID・接続先設定と、使うすべての端末・Chromeプロファイル・拡張の版を照合する。休止中・オフラインの端末も含める。確認できない端末があれば切替を止める。
- 新版拡張は `GET /api/v1/digest/delivery` が `cloud` を返すか、通信失敗・不正な記録などで確認できなければ送らない。記録なし・`none`・`extension` なら、サーバーの `enabled` にかかわらず拡張の本人の同意に従う。既存の拡張送信を維持するためにサーバー設定を新設する必要はない。詳しくは [切替確認の契約](data-shapes.md#拡張送信の切替確認issue-163) を参照。
- サーバーの旧GET制限と、体験用の専用GETを使うWebをそろえて出す。体験学生だけが `/api/v1/digest/demo-preview` を読め、通常利用者・支援担当は読めないことを確かめる。新版拡張だけの導入では、旧版の送信を止めたとは扱わない。デプロイの実行は別途承認された作業で行う。

### 本人ごとの切替順

1. **端末を確認する。** 全端末がそろい、同じ本人を操作していることを再確認する。切替中は端末の追加・再ログイン・準備予定の移動を止める。日本日付が変わったら記録を読み直して手順をやり直す。
2. **旧送信を止める。** 全端末の拡張のメール設定をOFFにし、実行中のGmail POSTとworkerの処理終了を確認する。LMS取得・カレンダー接続の設定は変えない。各端末の `digestReceipt:<接続設定のnamespace>:<uid>` の当日 `date` と `planIds`、`digestSchedule` の準備IDと開始日時だけを手元で照合する。メール本文・トークン・SIDや実際の課題をrepo・ログ・Issueへ出さない。
3. **サーバーで旧GETを止める。** 信頼された管理操作で本人の `notificationSettings/current` を `enabled: false, deliveryOwner: cloud, migrationState: not-started` にし、`version` を増やす。他の必須項目は契約どおり維持する。同じ本人の旧 `GET /api/v1/digest` が403で本文を返さず、新版拡張の確認が送信不可になることを確かめる。新旧の処理が取得済みの本文を持っていた場合に備え、手順2の終了確認を省かない。
4. **当日の記録を引き継ぐ。** 全端末の当日 `planIds` の和集合を使う。拡張の記録はPOST直前の予約を含み、配信成功の証拠ではないため、サーバーの `notificationDeliveries` には `accepted` でなく **`unknown`** として置く。キーと時間窓は [notification-targets.ts](../packages/server/src/notification-targets.ts) と同じ規則を使う。
   - 朝のID `morning` は、`JSON.stringify([uid, 日本日付, 'morning'])` のSHA-256（hex）。`scheduledAt` はその日の07:30、`expiresAt` は08:00のUTC表記、`kind: morning`。`planId/startsAt/planRevision` はnull。
   - 準備IDは、台帳の本人の予定と端末の保存日時を照合し、現在の開始日時も含む該当の開始日時ごとに `JSON.stringify([uid, planId, 開始日時のUTC ISO表記, 'reminder'])` のSHA-256（hex）。`kind: reminder`、開始30分前から開始までの時間窓、予定ID・正規化した開始日時・現在の予定の版を記録する。IDが解決できない、日時が不明、端末の記録が欠ける場合は移行完了にしない。
   - 各文書は契約の全項目を満たし、`settingsVersion` は手順3の版、`state: unknown, errorCode: outcome-unknown`、`attemptId/reservedAt/leaseUntil/startedAt` はnull、`respondedAt` は引継ぎ時刻にする。管理側のtransactionで未作成の場合だけ作り、既存の送信記録は上書きしない。通知状態に「受理済み」を作らない。文書のキー・件数・状態を読み戻して端末の和集合と照合する。このPRは引継ぎを実行する管理ツールを提供しないため、実行前にその操作を別途用意・レビューする。
5. **cloudを有効にする。** 実受信の証拠、全端末の停止、旧GETの403、引継ぎ記録の照合がそろってから、orangeが `migrationState: ready, enabled: true, deliveryOwner: cloud` にし、`version` を増やす。全端末のメール設定はOFFを維持する。設定保存やAPI受理を受信確認とは扱わない。

### 戻す順

1. まずサーバーの通知を `enabled: false` にして版を増やし、`deliveryOwner: cloud` を保つ。これで旧GETも止めたままになる。設定を削除しない。
2. クラウドの実行中の処理が終わるまで待ち、`reserved/sending` の記録を確認する。lease切れの回収も確認し、結果不明を再送しない。停止前に開始済みの1通は、停止後に受理される可能性がある。
3. クラウドの `accepted/unknown` と全端末の当日記録を和集合にし、戻す**1台だけ**の拡張の当日receiptへ、朝は `morning`、準備は `planId` として戻す。クラウド側は前日から始まる翌日00時台の準備も扱うため、拡張が扱う当日開始分を漏らさず照合する。不明・処理中の記録があればその日は拡張を有効にせず、クラウドも停止のままにする。
4. 記録を消さず、サーバー設定を `enabled: true, deliveryOwner: extension, migrationState: not-started` にして版を増やす。旧GETと新版拡張の確認が通ることを確かめてから、選んだ1台だけメールをONにする。他の端末はOFFを保つ。LMSとカレンダーはこの操作に含めない。

送信可否の確認とGmail POSTは1つのtransactionにはできない。確認の直後に設定を変えれば、その1通は送信され得る。全端末の停止と処理終了を確認してからcloudを有効にすることが切替の前提であり、確認GETだけで二重送信を完全に防ぐとは説明しない。
