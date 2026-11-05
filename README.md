# 課題の秘書（仮称）

大学の授業支援システムから課題を集め、学生の画面・カレンダー・面談画面につなぐ、DevFest GDGoC Japan Hackathon 2026の作品。

開発用repoは `shieikan/kadai-hisho`。今あるのは、共通の型、Chrome拡張の入口（YNU LMSのセッションIDを受け取るところまで）、ヘルスチェックAPI、学生と面談の空画面。課題の取得・台帳・カレンダー連携・ログインはこれから実装する。何が済んで何が残っているかは [PLAN.md](PLAN.md) を参照（`pnpm progress` で数える）。

## 開発を始める

Node 26とpnpm 11を使う。pnpmの固定版は [package.json](package.json) の `packageManager` を参照。

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

全パッケージをルートから確認する。CIも同じ順で実行する。Webは空画面だけなので、現時点ではテストファイルがなくても `test` が通る。

構成と作業の規則は [AGENTS.md](AGENTS.md)、データの意味は [docs/data-shapes.md](docs/data-shapes.md)、設計の判断は [docs/decisions.md](docs/decisions.md)（ライブラリの選定理由はD14）、画面の言葉は [docs/ui-words.md](docs/ui-words.md) を参照。

## 画面

```sh
pnpm --filter web dev
```

表示されたローカルURLの `/student` に学生の画面、`/session` に面談画面がある。ビルドした画面は `pnpm --filter web preview` で確認できる。

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

既定では `http://localhost:8080/healthz` が `{"status":"ok"}` を返す。`PORT` でポートを変更でき、待ち受け先は `0.0.0.0`。

Cloud Runのソースデプロイではrepoのルートをソースにする。buildpacks用の `gcp-build` がサーバーだけをビルドし、`start` が起動する。Nodeとpnpmの指定はルートの `engines` にある。デプロイはリソース作成と課金の確認を取ってから行う。詳細は [Node.js buildpacks](https://cloud.google.com/docs/buildpacks/nodejs) を参照。

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

観測APIはAuth・Firestoreのエミュレーターで試験できる（下記）。画面との接続は未実装。Firestoreの規則は全読み書きを拒否したままで、共有範囲に合わせた規則と試験は別途追加する。[Firebaseの接続手順とJavaの要件](https://firebase.google.com/docs/emulator-suite/connect_firestore) も参照。

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
