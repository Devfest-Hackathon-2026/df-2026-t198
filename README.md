# 課題の秘書（仮称）

大学の授業支援システムから課題を集め、学生の画面・カレンダー・面談画面につなぐ、DevFest GDGoC Japan Hackathon 2026の作品。

開発用repoは `shieikan/kadai-hisho`。何が済んで何が残っているかは [PLAN.md](PLAN.md) を参照（`pnpm progress` で数える）。

拡張機能なしで架空の課題と先生役の操作を試す手順は [模擬LMSを手元で試す](docs/demo.md)。

## 開発を始める

Node 26とpnpm 11を使う。pnpmの固定版は [package.json](package.json) の `packageManager` を参照。`pnpm test` はFirestoreのエミュレーターも起動するため、[JDK 21以上](#firebaseエミュレーター) が必要。

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

全パッケージをルートから確認する。CIも同じ順で実行する。

構成と作業の規則は [AGENTS.md](AGENTS.md)、データの意味は [docs/data-shapes.md](docs/data-shapes.md)、設計の判断は [docs/decisions.md](docs/decisions.md)（ライブラリの選定理由はD14）、画面の言葉は [docs/ui-words.md](docs/ui-words.md) を参照。

## 画面

```sh
pnpm --filter web dev
```

表示されたローカルURLの `/student` に学生の画面、`/session` に面談画面がある。ビルドした画面は `pnpm --filter web preview` で確認できる。面談のログイン・架空データ・API接続・試験は [面談画面のローカル確認](docs/session-development.md) を参照。

学生の画面は、拡張機能と同じGoogleアカウントでログインし、本人の授業・課題・更新の状態だけをFirestoreから読み取る。時間割と締切順の一覧から授業を選ぶと課題が開き、画面を開いたまま変更を受け取る。画面からFirestoreへの書き込みは行わない。

Firebaseの接続には、ビルド環境で `VITE_FIREBASE_PROJECT_ID`・`VITE_FIREBASE_API_KEY`・`VITE_FIREBASE_AUTH_DOMAIN` を指定する。FirebaseのWeb用設定を使い、管理用の秘密鍵やトークンは指定しない。未設定なら準備中の案内を出す。Googleでのログインを有効にし、画面のドメインが許可された既存のFirebaseプロジェクトを使う。プロジェクトの作成や設定変更はこの手順には含まない。

ローカルの架空データで確認する場合は、AuthとFirestoreのエミュレーターを起動し、別ターミナルで `VITE_USE_FIREBASE_EMULATORS=true pnpm --filter web dev --port 5176 --strictPort` を実行する。この設定は開発サーバーだけで有効。本物のFirebaseには接続しない。

ブラウザの確認は、手元のPlaywrightを使い、上の開発サーバーを起動した状態で次を実行する（エミュレーターが既に起動している場合は先に終了する）。`PLAYWRIGHT_MODULE` は既存のPlaywrightのES moduleへの絶対パス。試験用依存はworkspaceへ追加していない。

```sh
PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs pnpm exec firebase emulators:exec --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/student.browser.mjs"
```

空の状態から授業を開き、締切の変更、提出、接続断、狭幅、ログアウトまでを試す。架空の本人の文書は試験後に消す。スクリーンショットは `/tmp/kadai-i20-evidence/` に置く。通常の `pnpm test` は、このブラウザ確認を含まない。

色と書体は [tokens.css](packages/web/src/tokens.css) にまとめてある。フォントは端末に入っているものを順に使う。外部配信のフォントは読み込まない。

## Chrome拡張

```sh
pnpm --filter extension build
```

Chromeの `chrome://extensions` でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」から `packages/extension/dist` を選ぶ。更新後は拡張機能とLMSページを再読み込みする。

YNU LMSのURLのpathにSIDがあると、content scriptがSIDだけをservice workerへ渡す。workerは送信元とSIDの一致を確かめ、`chrome.storage.session` に保存する。LMSへのアクセスやサーバーへの送信はまだ行わない。SIDやSID付きURLをコンソールへ出さない。

## サーバー

```sh
pnpm --filter server build
pnpm --filter server start
```

既定では `http://localhost:8080/api/health` が `{"status":"ok"}` を返す。`PORT` でポートを変更でき、待ち受け先は `0.0.0.0`。

Cloud RunとFirebase Hostingへのデプロイは [デプロイ手順](docs/deploy.md) を参照。

## Firebaseエミュレーター

本物のFirebaseプロジェクトやログインは不要。コマンドは `demo-kadai-hisho` を指定し、各エミュレーターはローカルだけで待ち受ける。

Firestoreを含めて起動するには **JDK 21以上** が必要。`java -version` で確認し、Javaがない環境では先にJDKを用意する。この雛形のセットアップではJavaをインストールしない。

```sh
pnpm --filter web build
pnpm emulators
```

JavaなしでAuthenticationとHostingだけを確認する場合：

```sh
pnpm --filter web build
pnpm emulators:web
```

Hostingは `http://127.0.0.1:5002/student` と `/session`、管理画面は `http://127.0.0.1:4000`。全体起動時のFirestoreは8085、Authenticationは9099で動く。設定は [firebase.json](firebase.json)。初回はエミュレーターのダウンロードが発生する。

学生の画面の接続方法は [画面](#画面) を参照。Firestoreの規則は [設計案の共有範囲](docs/design.md#2-firestoreのデータの置き方と共有の範囲) に限って読み取りを許可し、画面からの書き込みはすべて拒否する。

規則だけの試験は `pnpm test:firestore-rules`。架空のプロジェクト `demo-kadai-hisho-rules` でFirestoreだけを起動し、試験後に停止する。手動で起動したエミュレーターと8085番ポートを共用するため、手動の方を先に終了しておく。macOSでは `/opt/homebrew/opt/openjdk@21/bin`、GitHub Actionsでは `JAVA_HOME_21_X64` のJavaを試験コマンドがPATHに足す。それ以外はJDK 21以上をPATHに置く。初回はダウンロードにネットワーク接続が必要。[Firebaseの接続手順とJavaの要件](https://firebase.google.com/docs/emulator-suite/connect_firestore) も参照。

観測APIはAuth・Firestoreのエミュレーターで試験できる（下記）。Firestoreの規則は上のとおり。[Firebaseの接続手順とJavaの要件](https://firebase.google.com/docs/emulator-suite/connect_firestore) も参照。

### 観測APIの試験

```sh
pnpm test:observations:emulator
```

AuthとFirestoreを `demo-kadai-hisho` で起動し、架空の利用者・観測を使ってAPIへの送信、保存、再送、取消、本人以外の保存先の拒否を試す。通常の `pnpm test` ではエミュレーターの4試験をskipするため、このコマンドも別途実行する。JDKがPATHにない場合は、インストール済みJDKのbinをPATHに加えて実行する。

APIを手動で動かす場合は、`pnpm emulators` の起動後、別のターミナルで次を実行する。

```sh
pnpm --filter server... build
GCLOUD_PROJECT=demo-kadai-hisho FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 pnpm --filter server start
```

送信形とAPIの応答は [データの形](docs/data-shapes.md)。エミュレーター用の環境変数はクラウドでは設定しない。

## 提出とライセンス

公開の提出先は `Devfest-Hackathon-2026/df-2026-t198`（remote名 `submission`）。提出時は確認したmainの履歴をそろえる。提出先ではGitHub ActionsとPagesを使えない。提出方法と締切は運営の案内に従う。

[MIT License](LICENSE)。外部の依存とライセンスは [docs/third-party.md](docs/third-party.md) に記録する。
