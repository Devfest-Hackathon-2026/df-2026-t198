# 課題の秘書（仮称）

大学の授業支援システムから課題を集め、学生の画面・カレンダー・面談画面につなぐ、DevFest GDGoC Japan Hackathon 2026の作品。

開発用repoは `shieikan/kadai-hisho`。この雛形には共通の型、Chrome拡張の入口、ヘルスチェックAPI、学生と面談の空画面がある。課題の取得・台帳・カレンダー連携・ログインはこれから実装する。

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

構成と作業の規則は [AGENTS.md](AGENTS.md)、データの意味は [docs/data-shapes.md](docs/data-shapes.md)、ライブラリの選定理由は [D14](docs/decisions.md#d14-開発用の雛形2026-11-05) を参照。

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

アプリとエミュレーターの接続は未実装。Firestoreの規則は全読み書きを拒否する状態から始める。接続を実装するときに、共有範囲に合わせた規則とテストを追加する。[Firebaseの接続手順とJavaの要件](https://firebase.google.com/docs/emulator-suite/connect_firestore) も参照。

## 提出とライセンス

公開の提出先は `Devfest-Hackathon-2026/df-2026-t198`（remote名 `submission`）。提出時は確認したmainの履歴をそろえる。提出先ではGitHub ActionsとPagesを使えない。提出方法と締切は運営の案内に従う。

[MIT License](LICENSE)。外部の依存とライセンスは [docs/third-party.md](docs/third-party.md) に記録する。
