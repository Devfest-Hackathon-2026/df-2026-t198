# 外部の依存とライセンス

直接追加した依存を記す。版は各 `package.json`、間接依存を含む解決結果は `pnpm-lock.yaml` を参照。ライセンス欄は導入したパッケージのメタデータで確認した（2026-11-05）。

| 名前・出典 | 用途 | ライセンス |
|---|---|---|
| [linkedom](https://github.com/WebReflection/linkedom) | 保存HTMLの解析。Node・service worker・模擬LMSのWeb画面で同じworker入口を使う（2026-11-06、導入物のLICENSEとpackage.jsonで確認） | ISC |
| [@google/genai](https://github.com/googleapis/js-genai) | Vertex AIで架空のお知らせから締切変更を抽出し、架空HTMLから読み取り定義の下書きを生成（[手順](definition-drafts.md)）。導入した2.32.0のpackage.jsonとLICENSEで確認（2026-11-06） | Apache-2.0 |
| [TypeScript](https://github.com/microsoft/TypeScript) | strictの型検査、coreとserverのビルド | Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint) | コードの静的検査 | MIT |
| [@eslint/js](https://github.com/eslint/eslint) | JavaScriptの推奨lint規則 | MIT |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | ESLintでのTypeScript解析と規則 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 単体テスト、Chrome APIのモック、HTTPテスト | MIT |
| [firebase-tools](https://github.com/firebase/firebase-tools) | Firebase Local Emulator Suiteの起動 | MIT |
| [firebase](https://github.com/firebase/firebase-js-sdk) | 拡張機能のGoogle credentialによるログイン。`firebase/auth/web-extension` をIIFEに同梱。ルートの開発依存はFirestoreの規則の試験、Webの直接依存は学生・面談・模擬LMS画面のログイン・Firestore購読に使う（2026-11-06、導入したpackage.jsonで確認） | Apache-2.0 |
| [@firebase/rules-unit-testing](https://github.com/firebase/firebase-js-sdk/tree/main/packages/rules-unit-testing) | 本人・支援担当・未ログインを模擬したFirestoreの規則の試験（2026-11-06、導入したpackage.jsonで確認） | Apache-2.0 |
| [firebase-admin](https://github.com/firebase/firebase-admin-node) | サーバーの認証・台帳保存と、学生画面の試験用データをエミュレーターに用意するために使う | Apache-2.0 |
| [esbuild](https://github.com/evanw/esbuild) | 拡張機能のservice worker・content script・設定画面のバンドル | MIT |
| [React](https://github.com/facebook/react) | 学生と面談の画面のコンポーネント | MIT |
| [react-dom](https://github.com/facebook/react) | ReactをブラウザのDOMへ描画 | MIT |
| [Vite](https://github.com/vitejs/vite) | Webの開発サーバーと静的ビルド | MIT |
| [@types/chrome](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/chrome) | Chrome拡張APIの型 | MIT |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) | サーバーのNode APIの型 | MIT |
| [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) | Reactの型 | MIT |
| [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) | React DOMの型 | MIT |
| [Playwright](https://github.com/microsoft/playwright) | 手元にある実行環境で学生・面談・模擬LMS画面のブラウザ試験を行う。workspaceの依存には追加しない（2026-11-06、実行環境のLICENSEで確認） | Apache-2.0 |

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

## 画面の見た目の案（2026-11-06）

`design/mocks/2026-11-06/` の画像8枚は [Nano Banana 2.1](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/nano-banana-2-1)（Vertex AI）の生成物。利用条件は [Google Cloud のサービス規約](https://cloud.google.com/terms/service-terms)を参照。参照画像2枚はrepo内の架空の試作を撮影したもの。外部の写真・ロゴ・フォントファイルは追加していない。

`design/mocks/2026-11-07/` の画像4枚も同じNano Banana 2.1（Vertex AI）による生成物で、上記のGoogle Cloudのサービス規約に従う。入力は架空のデータを含む依頼文だけ。外部の写真・参照画像・フォントは追加していない。

## 自動移動に使う授業時刻（Issue #112）

[YNU 全学教育科目時間割表（2025年3月21日現在）](https://ope.ynu.ac.jp/wp-content/uploads/2025/05/zengakujikanwari250328.pdf)の時限の開始・終了という事実のみを、YNUと架空の体験用の設定に使う。資料自体・レイアウト・説明文は複製しない。再利用ライセンスの指定は未確認であり、資料を同梱・再配布しない。レビューで値が一致したとされた出典へ修正した。今回の再取得は404のため値を再照合できていない。2026年度の表と別大学の時刻は未確認。

## メールのボタンの見た目（2026-11-07）

「今日やること」のメールの「✅ 終わった」「🕒 後回し」のボタンと、下の注意書きの色・大きさ・文言は、Soraの別のrepo `ynu-lms-agent` の `workers/sol/src/actions.mjs`（2026-11-07 02:22作成、大会の開始のあと）のメールに合わせた。Soraの作で、本人の許可（2026-11-07）を得て、見た目の値だけを `packages/server/src/digest/digest.ts` に写した。コードは写していない。

## LMS 仕様調査の出典とライセンス（KULMS / Sakai）

[`docs/kulms-api-comparison.md`](kulms-api-comparison.md) における KULMS（Sakai）関連の仕様調査は、以下の一次情報および上流リポジトリの参照に基づいています。

- **非転載・非同梱**: 本リポジトリには、KULMS の `/direct/describe` 等が出力する API 定義原文、Sakai のソースコード、および実環境の API 応答データや HTML を転載・同梱していません。文書には公開仕様上のエンドポイント構造とフィールド名のみを記録しています。
- **参照した Sakai 上流ソースファイルのライセンス**: 権限制御や小テスト項目の補助根拠として参照した [Sakai Project (`sakaiproject/sakai`)](https://github.com/sakaiproject/sakai) の [`GradebookNgEntityProvider.java`](https://github.com/sakaiproject/sakai/blob/5dc84ab5588662e202509cea3a6f5d3360a9da2d/gradebookng/tool/src/java/org/sakaiproject/gradebookng/rest/GradebookNgEntityProvider.java) および [`PublishedAssessmentEntityProviderImpl.java`](https://github.com/sakaiproject/sakai/blob/5dc84ab5588662e202509cea3a6f5d3360a9da2d/samigo/samigo-services/src/java/org/sakaiproject/tool/assessment/entity/impl/PublishedAssessmentEntityProviderImpl.java) は、各ファイルヘッダーにおいて **Educational Community License, Version 2.0 (ECL-2.0)** と明記されています（Sakai リポジトリ内の全ファイルについて一律に断定するものではありません）。
- **Issue #179のKULMS変換の補助根拠**：[AssignmentEntityProvider.java](https://github.com/sakaiproject/sakai/blob/5dc84ab5588662e202509cea3a6f5d3360a9da2d/assignment/tool/src/java/org/sakaiproject/assignment/entityproviders/AssignmentEntityProvider.java)（ECL-2.0、ファイルのヘッダーで確認）。授業別custom actionの全件応答、`SimpleSubmission.submitted` と提出者IDの仕様だけを参照し、コードは転載・同梱していない。KULMSに配備された版との一致は未確認。
- **Issue #180のサイト種別の補助根拠**：[Sakaiの既定設定](https://github.com/sakaiproject/sakai/blob/42305cf0907b989f2b6e548d332faa5832662eb5/config/configuration/bundles/src/bundle/org/sakaiproject/config/bundle/default.sakai.properties)が挙げる `course`・`project`・`workspace` という種別名のみを参照。リポジトリのLICENSEはECL-2.0（GitHub license APIで確認）、設定原文とコードは転載しない。KULASISの見本は調査文書の取得先・フィールドから架空の値で新しく書いたもので、実物のHTMLを入力にしていない。
- **Issue #180の拡張の通信経路**：[Chrome公式のCross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。content scriptとworkerのorigin制約・host permissionの説明だけを参照。文書はCC BY 4.0、コード例はApache-2.0とページに記載。原文・コード例は転載・同梱しない。

- **KULMS 自動生成 API 定義のライセンス表記**: KULMS 実環境の `/direct/describe` および `/direct/{prefix}/describe` が返す自己記述ページの個別ライセンス表記は未確認です（そのため原文の複製・同梱は行っていません）。

---

## KULASIS 調査に関する出典・ライセンス・利用境界

[docs/kulasis-data-comparison.md](./kulasis-data-comparison.md) の執筆にあたり参照した一次情報および外部資料の区分は以下のとおりです。

### 1. 大学の公式案内・関連資料

- 京都大学 情報環境機構 学生向けポータル・KULASIS 案内: <https://www.iimc.kyoto-u.ac.jp/ja/services/portal/student>
- 京都大学 大学から学生への連絡方針: <https://www.kyoto-u.ac.jp/ja/education-campus/cli/renraku>
- 京都大学 文学部・文学研究科 学生向け機能案内（機能紹介の参考資料であり、個人成績等の実測証拠ではない）: <https://www.bun.kyoto-u.ac.jp/wp-content/uploads/bun-student-handbook.pdf>

### 2. 調査時に認証経路の参考とした資料（`ku_auth_helper`）

- 参照先: [`orangeToT/ku_auth_helper` README (`723d775ab71098dc6718c2d3ffa7093d6aa5cf61`)](https://github.com/orangeToT/ku_auth_helper/blob/723d775ab71098dc6718c2d3ffa7093d6aa5cf61/README.md)
- ライセンス表記: 同リポジトリの README には `Private. Not for redistribution` と明記されています。
- 当プロジェクトにおける扱い:
  - 先行調査において SSO 認証経路を確認する際の参考資料としてのみ参照しました。
  - 当該リポジトリのコードの複製、リポジトリへの同梱、パッケージ依存としての導入は一切行っていません。
  - 調査前に書かれた外部コードを `kadai-hisho` の新実装の入力ソースとしては使用せず、今後の実装は文書化された調査知見のみを根拠とします。

### 3. 著作物・実応答・API 利用許諾に関する境界

- 今回の KULASIS 調査に関する加筆（[docs/kulasis-data-comparison.md](./kulasis-data-comparison.md) および関連追記）においては、実応答データ、HTML 原文、ならびに個人情報・認証情報の実値は含めておらず、汎用的なフィールド名と URL テンプレートのみを記録しています。
- 大学サイトにおける個別画面・API の自動取得や外部連携に関する明示的な利用許諾条件は未確認であり、本ドキュメントは転載許可や公式 API 契約の存在を推測・主張するものではありません。

## 紹介ページとロゴの書体（Issue #182）

Google Fonts のCSSから以下の書体を読み込む。フォントファイルはrepoに同梱しない。いずれも SIL Open Font License 1.1。

| 書体 | 用途 | 出典・ライセンス |
|---|---|---|
| Space Grotesk | ロゴ・欧文 | [Google Fonts](https://fonts.google.com/specimen/Space+Grotesk)、[OFL](https://github.com/google/fonts/blob/main/ofl/spacegrotesk/OFL.txt) |
| BIZ UDPGothic | 紹介ページ・学生・面談・体験用LMS、資料・動画・スライドの日本語。構成図PNGの描画と編集用SVGのフォント埋め込み | [Google Fonts](https://fonts.google.com/specimen/BIZ+UDPGothic)、[OFL](https://github.com/google/fonts/blob/main/ofl/bizudpgothic/OFL.txt) |
| JetBrains Mono | 番号・時刻 | [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono)、[OFL](https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt) |
| Zen Kaku Gothic New | 紹介ページの本文と見出し、学生・面談画面の見出し（2026-11-10 追加） | [Google Fonts](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New)、[OFL](https://github.com/google/fonts/blob/main/ofl/zenkakugothicnew/OFL.txt) |

紹介ページの配色・構成・文・格子のロゴは、Sora承認の見本（Issue #182、D37）に従う。掲載画像は、このrepoの体験用データをローカルのエミュレーターで描いた画面を撮影したもの。実LMS・実際の課題のデータ・外部の画像は使っていない。

## 構造整理の参考資料（Issue #151、2026-11-08）

| 出典 | 参考にした内容 | ライセンス |
|---|---|---|
| [Matt Pocock: Improve Codebase Architecture](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md) | 変更箇所の責務と入口を調べ、不要な委譲層を増やさない進め方 | MIT |
| [Vercel: React Best Practices](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md) | 直接importと状態の所有者を保つ観点 | MIT |
| [Vercel: Composition Patterns](https://github.com/vercel-labs/agent-skills/blob/main/skills/composition-patterns/SKILL.md) | 表示と状態・操作の責務の分離 | MIT |
| [Bulletproof React: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | 機能ごとの集約と共有部分への依存方向 | MIT |
| [Google Cloud: Cloud Run Node.js samples](https://github.com/GoogleCloudPlatform/nodejs-docs-samples/tree/main/run) | ローカル・単体・通し試験・配備を分ける検証 | Apache-2.0 |

方針の参照に限り、外部のコード・文書原文・テンプレートは複製していない。スキルのインストールや実行依存の追加も行っていない。

## 実行環境の仕様調査（Issue #196、2026-11-08）

本調査では仕様と既存事例を参照したのみで、原文や外部コードのコピーは行っていません。

| 出典 | 参照内容 | ライセンス・備考 |
| --- | --- | --- |
| [Cloud Run コンテナランタイム契約](https://docs.cloud.google.com/run/docs/container-contract) | Cloud Run PORT / `0.0.0.0` / SIGTERM 10秒 | Google文書 CC BY 4.0（ページ末尾確認済）。code samplesはApache 2.0（コピーなし） |
| [Node.js HTTP API ドキュメント](https://nodejs.org/api/http.html) | Node 26 `server.close` / `closeAllConnections` | 公式文書の参照のみ（コード複製なし、文書ライセンスは今回未確認） |
| [Firebase Auth Emulator 接続ガイド](https://firebase.google.com/docs/emulator-suite/connect_auth) | Auth emulator変数とunsigned token、本番混入禁止 | 文書 CC BY 4.0（確認済）、サンプル複製なし |
| [Cloud Firestore リアルタイムアップデート取得ガイド](https://firebase.google.com/docs/firestore/query-data/listen) | Firestore listener解除 | 文書 CC BY 4.0（確認済）、サンプル複製なし |
| [Firebase Admin Node.js SDK `deleteApp` リファレンス](https://firebase.google.com/docs/reference/admin/node/firebase-admin.app#deleteapp) | Admin app local資源解放 | 公式API文書の参照のみ（本文ライセンスはこの段階で個別未確認） |
| [Firebase Hosting と Cloud Run の統合ガイド](https://firebase.google.com/docs/hosting/cloud-run) | Hosting 60秒上限 | 文書 CC BY 4.0（確認済）、サンプル複製なし |
| [Google Gen AI SDK `HttpOptions` リファレンス](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html) | SDK通信timeout | 文書は参照のみ（文書ライセンスは未確認。既存依存 `@google/genai` 2.32.0 本体はApache 2.0として既存出典欄で確認済） |
| [Google Cloud Node.js Buildpacks ドキュメント](https://docs.cloud.google.com/docs/buildpacks/nodejs) | Procfile直接起動とbuild挙動 | 文書 CC BY 4.0（確認済）、サンプル複製なし |

## 共通UI（Issue #223、2026-11-09）

- [提供されたToDokuデザインシステム](https://claude.ai/artifact/HpENnWNWCcXAxgPsG8RKRC)の明るいテーマのトークンと `components/bundle.css` を、Issue #223の指示で採用。React部品はTypeScriptで実装し直した。チームから提供された制作物であり、独立した再配布ライセンスの指定は確認できていない。外部の写真・ロゴ・アイコンは追加していない。
- [Google Sans Flex](https://github.com/google/fonts/tree/main/ofl/googlesansflex)と[Google Sans Code](https://github.com/google/fonts/tree/main/ofl/googlesanscode)をGoogle Fontsから読み込む。両フォルダの `OFL.txt` でSIL Open Font License 1.1を確認（2026-11-09）。フォントファイル自体は同梱しない。既存のBIZ UDPゴシックと組み合わせる。
- 画面の移動は、[Chrome公式のView Transitions APIの説明](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)を参考に、ブラウザ標準APIと既存のReact DOMで実装した。ライブラリの追加はない。

## 紹介ページの構成の参考（Issue #224）

[株式会社ペンマークの企業サイト](https://corp.penmark.jp/)を、Sora提供の画面写しで確認し、見出し・余白・色面の配置だけを参考にした。ToDokuの既存の色・ロゴ・架空の画面を使用し、外部サイトの画像・写真・ロゴ・文章・コードは同梱していない。外部サイトの素材の再利用ライセンスは確認していないため、転載していない。

## しくみの素材見本（Issue #262、2026-11-10）

- **Open Peeps**：Pablo Stanleyによる人物のイラスト。[公式サイト](https://openpeeps.com/)にCC0と明記。人物の上半身・スマホを持つ姿勢・歩く姿勢と髪形のパスを、役ごとの1色のシルエットに加工した。
- **react-peeps 0.1.10**：[CeamKrier/react-peeps](https://github.com/CeamKrier/react-peeps)、[npm](https://www.npmjs.com/package/react-peeps)。MIT、Copyright (c) 2020-present, Emre Çakır。作業ツリー外で `npm pack react-peeps` を展開し、必要なパスだけを [peeps-paths.tsx](../packages/web/src/features/landing/story/peeps-paths.tsx) に取り込んだ。複製元のMIT全文は隣接する [LICENSE](../packages/web/src/features/landing/story/LICENSE) に保持。パッケージへの依存は追加していない。
- 机・ロゴなしのPC・時計・部屋・吹き出し・架空の画面は、この作品のSVGとして描いた。ToDokuのロゴは既存の `TodokuMark` を再利用した。

## 動画・スライドの素材と生成ツール（2026-11-10）

| 名前・出典 | 用途 | ライセンス |
|---|---|---|
| [Inter](https://github.com/google/fonts/tree/main/ofl/inter) | 動画・スライドの欧文と数字 | SIL Open Font License 1.1（[OFL](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt)、Copyright 2020 The Inter Project Authors） |
| [qrcode 8.2（python-qrcode）](https://github.com/lincolnloop/python-qrcode/tree/v8.2) | スライドのQRを生成。公開紹介ページのURLだけを符号化する。生成ライブラリとQR画像を区別する | BSD-3-Clause。[LICENSE](https://github.com/lincolnloop/python-qrcode/blob/v8.2/LICENSE)末尾にpyqrnative由来部分のMIT表記もあるため、生成用フォルダにはLICENSE全体を保持する |

BIZ UDPGothicとInterは2026-11-10にGoogle FontsのOFLを確認した。書体ファイルの配布・埋め込みでは著作権表示とOFL全文を保持する。文字を描画した動画・画像と書体ファイルを区別する。BIZ UDPGothicの出典とOFLは上の既存行を参照する。

人物シルエットは既存のOpen Peeps（CC0）とreact-peeps（MIT）の記録を参照する。制作記録で確認できた用途を補足したもので、最終動画・Google Slidesでの採用範囲、書体の置換、取り込み後のQRの読み取りは未確認。
