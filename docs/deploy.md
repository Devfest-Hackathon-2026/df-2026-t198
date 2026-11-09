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

`PUBLIC_WEB_ORIGIN` は、今日やることのメールに入れる学生画面のリンク先。上のHostingの公開先を指定する。未設定では `GET /api/v1/digest` が503を返し、体験用LMSの「今朝のメール」も表示できない（ほかのAPIは起動する）。クラウド通知への本人による切替は、下のIssue #274の注記に従う。Issue #162のクラウド送信の準備は末尾を参照。

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

## 共用の体験の準備（Issue #178）

実行は人のOKを受けた統合役が行う。先に [Cloud Run](#cloud-run) のコマンドでこの版のAPIを反映し、Geminiの事故止めを、共用の組の別枠と審査用・通常の枠に分ける。両枠の額と保存先は [データの契約](data-shapes.md#お知らせの受信と要確認issue-45) を参照。設定を変えずにAPIの版で適用し、共用の回数制限は置かない。Firebase・Google Cloudの設定や資源は追加しない。次の入口は固定プロジェクト・明示引数・エミュレーター設定なしを要求し、既存のアカウント・プロフィール・体験データ・共有許可・面談日時・保存ファイルがあれば停止する。

```sh
node packages/server/scripts/seed-demo-live.mjs --project project-00439085-4e2d-44c3-9a8 --create-public-pair
```

乱数パスワードを `fixtures-local/public-demo-accounts.local.json` に権限600で排他的に保存してから、`public-1` の学生・支援担当と文書を作る。既存の審査用3組のファイルもアカウントも触らない。途中失敗時は保存ファイルを消して再実行せず、作成状態を確認する。

WebのFirebase接続用3変数は [READMEの画面設定](../README.md#画面) のとおり環境に用意する。共用の4変数は次のコマンドで上記のローカルファイルからビルドプロセスにだけ渡す。値を手入力したコマンド、ログ、Issue、PRに残さない。これら4変数は公開用の架空アカウント専用で、ビルドしたJavaScriptから見える。実物の利用者や管理権限の認証情報を渡さない。

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
try {
  const data = JSON.parse(await readFile('fixtures-local/public-demo-accounts.local.json', 'utf8'));
  const pair = data.pairs.find(pair => pair.pair === 'public-1');
  if (!pair || data.projectId !== process.env.VITE_FIREBASE_PROJECT_ID ||
      !process.env.VITE_FIREBASE_API_KEY || !process.env.VITE_FIREBASE_AUTH_DOMAIN) {
    throw new Error('public-demo-build-configuration-required');
  }
  const env = { ...process.env };
  for (const role of ['student', 'supporter']) {
    env[`VITE_PUBLIC_DEMO_${role.toUpperCase()}_EMAIL`] = pair[role].email;
    env[`VITE_PUBLIC_DEMO_${role.toUpperCase()}_PASSWORD`] = pair[role].password;
  }
  const result = spawnSync('pnpm', ['--filter', 'web', 'build'], { env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch {
  process.stderr.write('public-demo-build-failed\n');
  process.exitCode = 1;
}
NODE
```

4つの変数は `VITE_PUBLIC_DEMO_STUDENT_EMAIL`、`VITE_PUBLIC_DEMO_STUDENT_PASSWORD`、`VITE_PUBLIC_DEMO_SUPPORTER_EMAIL`、`VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD`。1つでも欠ければ両方のボタンを出さない。ビルド成功後に [Hosting](#hosting) のコマンドを実行する。共用のボタンが `/demo-lms` のログイン欄の上にあり、学生は `/demo-lms`、支援担当は `/session` に入ることを別のブラウザで確認する。延長→LMSを開く→開いたままの面談画面の更新、やり直し、審査用3組へのログインも確認する。失敗時は審査用アカウントへ案内し、締切後は共用の組を修復しない（[D38](decisions.md#d38-紹介ページから入れる共用の体験の組を足す2026-11-08issue-178)）。

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

Issue #274以降の通常の利用者は、学生画面の「メール通知の設定」で「通知を有効にする」を押して切り替える。送信元と本人の宛先が利用できる場合の動作・切替済み利用者との互換性は [設定APIの契約](data-shapes.md#通知設定api) に従う。停止しても拡張へは戻さない。新しいCloudリソースの作成や送信元の再設定は不要。

以下は従来の手動切替を必要とする場合の手順で、通常の本人による切替の前提ではない。実行者はorange。手順の記述を切替の実行記録とは扱わない。#162の送信元接続とクラウドから本人への実受信（朝・準備前）が通るまで、cloudを有効にしない。11/9 18:00の打ち切りと凍結期間は #152 と [提出の決まり](submission.md) に従う。LMS取得とカレンダー同期は拡張に残す。

### 切替前の確認

- 本人のUID・接続先設定と、使うすべての端末・Chromeプロファイル・拡張の版を照合する。休止中・オフラインの端末も含める。確認できない端末があれば切替を止める。
- 新版拡張は `GET /api/v1/digest/delivery` が `cloud` を返すか、通信失敗・不正な記録などで確認できなければ送らない。記録なし・`none`・`extension` なら、サーバーの `enabled` にかかわらず拡張の本人の同意に従う。既存の拡張送信を維持するためにサーバー設定を新設する必要はない。詳しくは [切替確認の契約](data-shapes.md#拡張送信の切替確認issue-163) を参照。
- サーバーの旧GET制限と、体験用の専用GETを使うWebをそろえて出す。体験学生だけが `/api/v1/digest/demo-preview` を読め、通常利用者・支援担当は読めないことを確かめる。新版拡張だけの導入では、旧版の送信を止めたとは扱わない。デプロイの実行は別途承認された作業で行う。

### 本人ごとの切替順

1. **端末を確認する。** 全端末がそろい、同じ本人を操作していることを再確認する。切替中は端末の追加・再ログイン・準備予定の移動を止める。日本日付が変わったら記録を読み直して手順をやり直す。
2. **旧送信を止める。** 全端末の拡張のメール設定をOFFにし、実行中のGmail POSTとworkerの処理終了を確認する。LMS取得・カレンダー接続の設定は変えない。各端末の `digestReceipt:<接続設定のnamespace>:<uid>` の当日 `date` と `planIds`、`digestSchedule` の準備IDと開始日時だけを手元で照合する。メール本文・トークン・SIDや実際の課題をrepo・ログ・Issueへ出さない。
3. **サーバーで旧GETを止める。** 信頼された管理操作で本人の `notificationSettings/current` を `enabled: false, deliveryOwner: cloud, migrationState: not-started` にし、`version` を増やす。他の必須項目は契約どおり維持する。同じ本人の旧 `GET /api/v1/digest` が403で本文を返さず、新版拡張の確認が送信不可になることを確かめる。新旧の処理が取得済みの本文を持っていた場合に備え、手順2の終了確認を省かない。
4. **当日の記録を引き継ぐ。** 全端末の当日 `planIds` の和集合を使う。拡張の記録はPOST直前の予約を含み、配信成功の証拠ではないため、サーバーの `notificationDeliveries` には `accepted` でなく **`unknown`** として置く。キーと時間窓は [notification-targets.ts](../packages/server/src/notifications/targets.ts) と同じ規則を使う。
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

## 専用Gmailの通知準備（Issue #162、実行はorange）

D36のA1（専用Gmailからの送信）およびCloud Schedulerの毎分実行はorangeが決定し、2026-11-08に専用OAuth・Secret Manager 3項目・専用SA・Cloud Scheduler 1件の準備を完了した（実行記録は [2026-11-08-issue-152.md](records/2026-11-08-issue-152.md)。Issue #153 BE-02のもと、宛先が取れないときに送信しない既存実装を維持している）。ただし、以下の手順例にはOAuth Playground等の別手順や送信有効化も含まれるため、下記の手順例全体を実行済みとは扱わない。2026-11-08時点では一時的なlocalhostコールバックで更新トークンを取得し、`NOTIFICATION_SEND_ENABLED=false`（送信無効）を維持している。実メールの送受信確認、送信元表示名の実受信確認、拡張メールの停止、利用者の移行状態（`deliveryOwner` / `migrationState`）の切替は未実施。

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

このフラグだけでは、移行前の本人は送信対象にならない。Issue #274以降は、本人が学生画面で有効にすると設定APIが切り替える（[設定APIの契約](data-shapes.md#通知設定api)）。通常の利用者を手動で1人ずつ移行する必要はない。本手順には移行状態を直接書き換えるコマンドを含めない。11/9 18:00までにAC-02/03の実受信が通らなければ切替を止める（#152）。

自然時刻の朝と準備前で、予定時刻・処理開始・API受理・本人Gmailの受信を別々に記録する。PC/Chromeを閉じた条件、停止、失効、結果不明も確かめる。Gmailの401/403は接続のやり直し、429は未受理、5xx/応答喪失/不完全な成功応答は結果不明。いずれも送信POSTを自動再送しない。invalid_grant等で止まった送信元は、凍結前に再同意・固定版更新・revision更新で復旧する。

公式資料：[Gmail送信API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)、[エラー](https://developers.google.com/workspace/gmail/api/guides/handle-errors)、[offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline)、[Testingの7日期限](https://developers.google.com/identity/protocols/oauth2#expiration)、[Cloud Runのsecret](https://docs.cloud.google.com/run/docs/configuring/services/secrets)、[SchedulerのOIDC](https://docs.cloud.google.com/scheduler/docs/http-target-auth)。

## 実行環境の境界（Issue #196）

### 終了処理

Cloud RunはSIGTERM送信の10秒後にSIGKILLを送る仕様です。Nodeサーバーは通常のSIGTERM/SIGINT受信時に一度だけ終了処理を実行し、新規受付停止、進行中HTTPリクエストの完了待ち、使用中Firestoreの`terminate`、対応するFirebase appの解放を順に行います（全appやバックエンドデータの削除は行いません）。アプリ側の終了期限は10秒未満に収める実装上の選択として9秒に設定し、期限超過や解放失敗時はexit code 1で終了します。期限超過時は進行中の処理を完了できない場合があり、強制終了時のDB書込みやメール配信の取消・成功は保証されません。実Cloud環境でのSIGTERM試験は未実施です。

### 本番とローカルの分離

サーバーで`FIREBASE_AUTH_EMULATOR_HOST`または`FIRESTORE_EMULATOR_HOST`を設定する場合は、両方をループバックホスト（`127.0.0.1`、`localhost`、`[::1]`）と1〜65535のポートで指定し、appと環境のproject IDを同じ`demo-*`へ揃えてください。サーバーの新規appでエミュレーターを使うときは、`GOOGLE_CLOUD_PROJECT`または`GCLOUD_PROJECT`の少なくとも1つで`demo-*`のproject IDを明示し、SDKが後から別projectを選ぶ問題を避けるためその検査済みproject IDを`initializeApp`へ直接渡します。`FIREBASE_CONFIG`（JSONまたはファイル）によるローカルprojectの暗黙切り替えは行いませんが、エミュレーターを使わない本番では既存の`FIREBASE_CONFIG`（JSONまたはファイル）による暗黙設定を維持します。`NODE_ENV=production`または`K_SERVICE`の設定時はエミュレーター設定を拒否し、環境変数値をエラーに出力せずSDK初期化前に停止するため、本番環境へエミュレーター変数を持ち込まないでください。Webエミュレーターは、Vite DEV実行時かつページhostnameが`127.0.0.1`または`localhost`でポートが有効な場合のみ`demo-kadai-hisho`へ接続します。productionビルドでのエミュレーター指定、非ループバック、無効なポートの場合は本番へフォールバックせず既存の準備中表示となり、通常のFirebase公開設定欠落時のnull/準備中動作は維持されます。

### 通信期限と購読

Firebase Hostingの同期リクエスト上限（60秒）に合わせ、HTTPに組み込むGemini SDKの通信タイムアウトは45秒としています（評価CLI等の既定120秒、試行1回、予算の予約/settle、model-error扱いは維持）。45秒はSDK通信の上限であり、ADCやFirestoreのreserve/settle等を含むHTTP全体が60秒以内に終わる保証ではありません。実Geminiの待ち時間計測および本番配備は未実施です。また、カレンダー/メール見本のFirestoreリスナーで失敗した場合は兄弟リスナーも停止し、遅延コールバックとpending responseを無視します（通常時のデザイン・文言・操作は変わりません）。
