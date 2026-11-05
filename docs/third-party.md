# 外部の依存とライセンス

直接追加した依存を記す。版は各 `package.json`、間接依存を含む解決結果は `pnpm-lock.yaml` を参照。ライセンス欄は導入したパッケージのメタデータで確認した（2026-11-05）。

| 名前・出典 | 用途 | ライセンス |
|---|---|---|
| [linkedom](https://github.com/WebReflection/linkedom) | 保存HTMLの解析。Nodeとservice workerで同じworker入口を使う（2026-11-06、導入物のLICENSEとpackage.jsonで確認） | ISC |
| [TypeScript](https://github.com/microsoft/TypeScript) | strictの型検査、coreとserverのビルド | Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint) | コードの静的検査 | MIT |
| [@eslint/js](https://github.com/eslint/eslint) | JavaScriptの推奨lint規則 | MIT |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | ESLintでのTypeScript解析と規則 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 単体テスト、Chrome APIのモック、HTTPテスト | MIT |
| [firebase-tools](https://github.com/firebase/firebase-tools) | Firebase Local Emulator Suiteの起動 | MIT |
| [firebase](https://github.com/firebase/firebase-js-sdk) | 拡張機能のGoogle credentialによるログイン。`firebase/auth/web-extension` をIIFEに同梱（2026-11-06、導入したpackage.jsonで確認） | Apache-2.0 |
| [esbuild](https://github.com/evanw/esbuild) | 拡張機能のservice worker・content script・設定画面のバンドル | MIT |
| [React](https://github.com/facebook/react) | 学生と面談の画面のコンポーネント | MIT |
| [react-dom](https://github.com/facebook/react) | ReactをブラウザのDOMへ描画 | MIT |
| [Vite](https://github.com/vitejs/vite) | Webの開発サーバーと静的ビルド | MIT |
| [@types/chrome](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/chrome) | Chrome拡張APIの型 | MIT |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) | サーバーのNode APIの型 | MIT |
| [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) | Reactの型 | MIT |
| [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) | React DOMの型 | MIT |

## 実行環境とCI

| 名前・出典 | 用途 | ライセンス |
|---|---|---|
| [gitleaks](https://github.com/gitleaks/gitleaks) | Git履歴の秘密検出。固定版・取得元・チェックサム検証は [.github/workflows/ci.yml](../.github/workflows/ci.yml)。公式Actionは使わず本体を実行（2026-11-06、v8.24.3の[LICENSE](https://github.com/gitleaks/gitleaks/blob/v8.24.3/LICENSE)を確認） | MIT |
| [Node.js](https://github.com/nodejs/node) | 開発とサーバー実行。HTTPサーバーは標準の `node:http` | MIT（同梱部分の告知はNodeのLICENSEを参照） |
| [pnpm](https://github.com/pnpm/pnpm) | workspaceの依存管理とコマンド実行 | MIT |
| [actions/checkout](https://github.com/actions/checkout) | CIでソースを取得 | MIT |
| [actions/setup-node](https://github.com/actions/setup-node) | CIのNodeを指定 | MIT |
| [pnpm/action-setup](https://github.com/pnpm/action-setup) | CIのpnpmを指定、依存のキャッシュ | MIT |

Firebase CLIの間接依存である [protobufjs](https://github.com/protobufjs/protobuf.js)（BSD-3-Clause）はpostinstallを許可する。[re2](https://github.com/uhop/node-re2)（BSD-3-Clause）は任意依存で、ネイティブビルドは無効にしている。Hostingエミュレーターは [superstatic](https://github.com/firebase/superstatic)（MIT）のJavaScript処理を使う。

画面の色と書体の指定はrepo内の `design/prototypes/2026-11-05/merged.html` に合わせた。フォントファイルや外部画像は配布物に追加していない。

CoursePower（富士通）の画面の構造を抽出・架空化した試験用HTMLを `lms-definitions/coursepower/samples/` に置く。
