# 拡張機能のGoogle接続テスト

目的は [設計案の4節・5節](../docs/design.md) の実機確認。試験用カレンダーに明日の5分間の架空の予定を作る。既存の課題データやCloud Runは使わない。Chrome 105以降が必要。

1. Soraが、Firebaseと同じGoogle CloudプロジェクトでCalendar API、OAuth同意画面（テスト利用者に自分を登録）、種類が「Chrome拡張機能」のOAuthクライアントを用意する。拡張機能IDには **`ghlhpjencbpglkbjmhadcbjgjpngdhll`** を指定する。FirebaseにWebアプリを登録し、AuthenticationのGoogleプロバイダーを有効にする。[公式案内](https://firebase.google.com/docs/auth/web/chrome-extension)に従い、認証の許可ドメインに `chrome-extension://ghlhpjencbpglkbjmhadcbjgjpngdhll` を追加する。これらのCloud設定は、この部品では作成しない。
2. `packages/extension/config.example.json` を同じ場所の `config.local.json` にコピーする。`oauthClientId` に上のChrome拡張用クライアントIDを入れる。`firebase.apiKey`・`firebase.authDomain`・`firebase.projectId`・`firebase.appId` にFirebase Webアプリの設定を入れる。Web用OAuthクライアントID、クライアントsecret、サービスアカウント鍵は入れない。設定ファイルと秘密鍵はgit管理外。
3. repoルートで `pnpm install --frozen-lockfile`、`pnpm --filter extension build` を実行する。設定を変えた後も再ビルドする。設定が空・不正でも読み込める拡張機能になり、画面に不足した項目名が出る。
4. 試すGoogleアカウントでログインしたChromeプロファイルで `chrome://extensions` を開く。「デベロッパーモード」を有効にし、「パッケージ化されていない拡張機能を読み込む」から **このworktreeの `packages/extension/dist/`** を選ぶ。表示された拡張機能IDが上記と一致することを確認する。「詳細」→「拡張機能のオプション」を開く。再ビルドしたら拡張機能を再読み込みし、設定画面も開き直す。
5. **「Googleと連携して試す」** を押す。同意画面でアカウントと権限を確認する。要求するのは `openid`・`email`・`https://www.googleapis.com/auth/calendar.app.created`。成功すると各段に「成功」、uidの先頭8文字、カレンダー名「課題の秘書・接続テスト」、予定IDが出る。Googleカレンダーでも専用カレンダーに架空の予定が1つあることを確認する。初回の「前回との一致はまだ確認できません」は正常。
6. **同じボタンをもう一度押す。** 「同じ予定IDが既にあります（HTTP 409、内容も一致）」が出て、予定IDと予定の数が変わらないことを確認する。この試験が終わるまで予定を編集・削除しない。
7. service workerのDevToolsを閉じる。`chrome://serviceworker-internals` で、このIDの `chrome-extension://…/service-worker.js` だけを探して **Stop** を押す（Unregisterは押さない）。設定画面で **「保存したログインを確認」** を押す。「前回と同じuidに戻りました」「前回の実行時とは別の起動です」が両方出れば、別の起動で復元したことを確認できる。新たにGoogle認証や予定作成は行わない。Stopが見つからない場合は検証画面を閉じて停止を待ち、同じボタンを押す。「前回と同じ起動です」なら再開はまだ未確認。

失敗した段と固定の説明文だけを表示し、SDKやHTTPの生のエラー、トークンは表示・記録しない。設定の不足は2〜4をやり直す。Google連携の失敗は、Chromeのログイン、同意画面のテスト利用者、Chrome拡張用IDを確認する。Firebaseの失敗はGoogleプロバイダーと同じプロジェクトのWeb設定を確認する。HTTP 403ならCalendar APIと同意した権限を確認する。

「前回のカレンダー作成が終わったか不明です」と出たら、ボタンの連打や再インストールはせず、Googleカレンダーに専用カレンダーができているか確認して復旧を相談する。POST後の通信切断や手元への保存失敗では、作成済みか判定できないため再作成しない。ローカルの `authProbeState` を消すとこの保護も消える。試験は同じプロファイル・同じGoogleアカウントで続ける。

`manifest.json` の公開鍵でIDを固定しているため、別の場所へunpacked拡張機能をコピーしても同じIDになる。`fixtures-local/extension-key.pem` は秘密鍵（権限600）。unpackedで読み込むときには使わず、再生成・commit・配布しない。ビルドした `dist/` にもWeb設定が入るためcommitしない。Firebaseのログイン情報はSDKのIndexedDBに保存し、独自の永続領域にGoogleアクセストークンは保存しない。

実アカウントでの認可・予定作成・停止後の復元は、Soraが上の手順を実行するまで未確認。`PLAN.md` の完成条件は、この部品の自動試験だけでは完了にしない。

APIの根拠：[専用カレンダーの作成](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert)、[予定IDの指定](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)、[HTTP 409](https://developers.google.com/workspace/calendar/api/guides/errors#409_the_requested_identifier_already_exists)、[Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)。
