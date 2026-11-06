# KULMS (Sakai) API 調査および現行 LMS 実装との比較

## 1. 目的と前提

本資料は、[Issue #2](https://github.com/shieikan/kadai-hisho/issues/2)（京都大学 LMS 対応）を引き継ぐ実装担当に向け、2026-11-06 時点で確認済みの KULMS（Sakai EntityBroker `/direct` API）の仕様・実測結果と、`kadai-hisho`（比較対象コミット: `2732f359218a8167dd5264a48e36f0e74e0ec9e2`）における YNU LMS（CoursePower）・模擬 LMS（`demo-lms`）および共通契約との比較をまとめた調査文書である。

### 記載方針・制約
- **調査と未決事項の区別**: 本書は調査結果と設計上の検討事項を記録するものであり、技術選定・共通型・API 契約・共有範囲の変更を決定するものではない（[`PLAN.md`](../PLAN.md) の C08/C09 は未完了）。
- **個人情報の非記録**: 実アカウントの件数、氏名、ID、実課題名、本文、点数、ファイル名、Cookie、セッション ID、資格情報、認証 URL パラメーター、および実応答 JSON や HTML 原文は記録しない。公開仕様のフィールド名と URL テンプレートのみを記載する。
- **入力の範囲**: 新規実装の根拠は本書の調査知見と既存リポジトリの正本のみとし、別実装のコードは参照対象としない。
- **検証状態の正確な表記**: 「現行 collector では未収集」「定義のみ確認」「今回の条件では 500」「200 空」等を区別し、LMS 製品全体の機能不存在や未認証と混同しない。

---

## 2. 接続先・識別子・認証方式の前提

- **接続先 URL**: 現行の KULMS 実接続先は `https://lms.gakusei.kyoto-u.ac.jp` であり、旧 PandA（`https://panda.ecs.kyoto-u.ac.jp`）とは別システムである（出典: [京都大学情報環境機構 LMS 案内](https://www.iimc.kyoto-u.ac.jp/ja/services/education/lms)）。
- **システム識別子**: [`packages/core/src/types.ts`](../packages/core/src/types.ts) では `LmsSystem` として `'ynu-lms' | 'panda' | 'demo-lms'` が定義されているが、`'panda'` の実コネクターは未実装である。KULMS を既存の `'panda'` に対応させるか識別子を見直すかは要確認事項とする。
- **認証と取得方式**:
  - [Issue #2](https://github.com/shieikan/kadai-hisho/issues/2) の方針により、学生本人がブラウザでログイン済みの LMS を Chrome 拡張から読み取り、サーバーに LMS の認証情報（パスワード・TOTP 等）を持たせず、ログイン自動化も行わない。
  - 2026-11-06 の調査では、SSO 認証後の Cookie 付き HTTP セッションを用いた HTTP GET により `/direct` 配下の JSON 応答が取得できることを確認した（ブラウザ上の Chrome 拡張からの実行確認とは別である）。
  - 現行の [`packages/extension/manifest.json`](../packages/extension/manifest.json) では、`host_permissions` は Google 系 API のみで LMS の `host_permissions` はなく、`content_scripts.matches` が `https://lms.ynu.ac.jp/*` のみとなっている（[`packages/extension/src/lms-request.ts`](../packages/extension/src/lms-request.ts) 等もこの構成を前提とする）。KULMS からの同一オリジン取得や必要権限の設計、Chrome 拡張からの fetch、CORS / SameSite Cookie の挙動、セッション保持時間、再認証・多要素認証を含む継続動作は未確認・未検証（`NOT_RUN`）である。

---

## 3. KULMS `/direct` API 調査結果

KULMS の EntityBroker は自己記述 API（[`/direct/describe`](https://lms.gakusei.kyoto-u.ac.jp/direct/describe) および各 `/direct/{prefix}/describe`、参考: [Sakai EntityBroker RESTful URL support](https://sakaiproject.atlassian.net/wiki/spaces/SAKDEV/pages/16309354617/EntityBroker%2BRESTful%2BURL%2Bsupport)）を持ち、調査時点で 38 個の prefix 定義を確認した。なお、**API 定義の存在と実データ取得の成否は別**である。

### 3.1 実データ取得を確認した GET エンドポイント
ベース URL: `https://lms.gakusei.kyoto-u.ac.jp/direct`

| 領域 | エンドポイント / パラメーター例 | 確認した主要フィールド | 実測上の注意点・制約 |
| :--- | :--- | :--- | :--- |
| サイト一覧 | `/site.json?_limit=200&_start=0` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/site/describe)) | `id`, `title`, `type`, `description`, `htmlDescription`, `createdDate`, `lastModified`, `published`, `pubView`, `contactName`, `contactEmail`, `sitePages` | アクセス可能なサイト一覧であり、正式な履修登録授業とは限らない。`contactName`/`contactEmail` は未設定の例あり。`_start`/`_limit` によるページ分割で空配列の終端まで到達を確認。サーバー側上限を考慮し全件走査が必要。 |
| サイト詳細 | `/site/{siteId}.json?includeGroups=true` | サイト単体の属性・グループ定義等 | サイト単位の詳細確認用。 |
| ページ・ツール配置 | `/site/{siteId}/pages.json` | ページ `id`, `title`, `url`, `tools[]`（`toolId`, `title`, `description`, `url`, `placementId`, `pageOrder` 等） | 当該授業サイト内で有効化・配置されているツールの判別に利用可能。 |
| 授業資料 | `/content/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/content/describe)) | `content_collection`: `title`, `type`(MIME), `size`, `container`, `author`, `authorId`, `modifiedDate`, `description`, `url`, `hidden`, `visible`, `fromDate`, `endDate`, `webLinkUrl` | メタデータ取得を確認。ファイル本体の一括ダウンロードは `NOT_RUN`。 |
| 課題一覧 | `/assignment/site/{siteId}.json`<br>`/assignment/my.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/assignment/describe)) | `assignment_collection`: `id`, `context`(siteId), `title`, `instructions`, `attachments`, `openTime`, `dueTime`, `closeTime`, `dropDeadTime`, 各 `*TimeString`, `timeCreated`, `timeLastModified`, `submissionType`, `status`, `allowResubmission`, `allowPeerAssessment`, `anonymousGrading`, `maxGradePoint`, `gradeScale`, `gradeScaleMaxPoints`, `gradebookItemId`, `gradebookItemName`, `submissions` | 権限や公開状態により `null` や空配列となる項目がある。`openTime`（開始）・`dueTime`（締切）・`closeTime`（受付終了）は意味が異なるため同一視せず、`dropDeadTime` の意味も `closeTime` と同義と決めつけず別途要確認とする。`dueTime` 等の時刻オブジェクトは `{epochSecond, nano}` 形式（秒単位）であり、JavaScript のミリ秒と取り違えないこと。`null` のみをもって「締切なし」と断定せず未設定・特殊値の扱いを要確認。 |
| 自分の提出・採点 | 上記課題内の `submissions[]` | `submitted`, `draft`, `status`, `canSubmit`, `dateSubmitted`, `dateSubmittedEpochSeconds`, `late`, `submittedText`, `submittedAttachments`, `graded`, `returned`, `grade`, `feedbackComment`, `feedbackText`, `feedbackAttachments`, `userSubmission`, `visible`（添付は `name`, `ref`, `size`, `type`, `url`） | `submittedText`, `submittedAttachments`, `grade`, `feedbackComment`, `feedbackAttachments` は実値のある例を確認。`feedbackText` はフィールド存在のみ確認し実値例なし。`submissions` の欠落や未公開状態を「未提出」と決めつけず `unknown` として扱う考慮が必要。 |
| お知らせ | `/announcement/user.json?n=100&d=365`<br>`/announcement/site/{siteId}.json?n=100&d=365` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/announcement/describe)) | `announcement_collection`: `announcementId`, `title`, `body`, `createdByDisplayName`, `createdOn`, `siteId`, `siteTitle`, `attachments`, `highlight`, `selectedRoles` | 実値は `user.json`（横断）で確認し、確認した `site` サンプルは空。件数 `n`・日数 `d` の制限があるため既定条件を全件とみなさない。 |
| カレンダー | `/calendar/my.json?firstDate=2026-04-01&lastDate=2027-03-31`<br>`/calendar/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/calendar/describe)) | `calendar_collection`: `eventId`, `title`, `description`, `creator`, `siteId`, `siteName`, `type`, `duration`, `firstTime`, `assignmentId`, `recurrenceRule` | 横断の `my.json` で実値を確認（`site` サンプルは空）。`firstTime` は `{display, time}` で `time` はミリ秒形式の数値（課題の `epochSecond` と単位が異なる）。`assignmentId` を持つ課題由来イベントが含まれるため課題と二重計上しないこと。 |
| 所属情報 | `/membership.json?includeGroups=true` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/membership/describe)) | `locationReference`, `memberRole`, `active`, `userId`, `userEid`, `userDisplayName`, `userEmail`, `lastLoginTime` | 自身のサイト所属・ロール情報の取得を確認。 |
| 自分のユーザー情報 | `/user/current.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/user/describe)) | `id`, `eid`, `displayId`, `displayName`, `firstName`, `lastName`, `email`, `createdDate`, `lastModified`, `props`（`password` は `null`） | 自身の属性取得を確認。ただし表示 ID 等から学籍番号が常に取得できるとは断定しない。 |
| サイト内権限 | `/site/{siteId}/userPerms.json` | 自身に許可された権限文字列の `data` 配列 | サイトごとの操作・閲覧権限の確認用。 |
| 外部連携ツール (LTI) | `/lti/{siteId}/tools.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/lti/describe)) | 登録ツールの `title`, `description`, `launch`, 表示・連携設定等 | 外部サービス内の学習記録そのものではない。秘密・鍵を思わせる設定値は保存・引用しない。 |
| システム登録ツール | `/tool.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/tool/describe)) | `id`, `title`, `description`, `categories`, 設定等 | システム全体のツール一覧であり、各授業で有効なツール（`pages.json` の `tools`）とは別。 |

### 3.2 空応答・エラー・定義のみ確認・未実施の項目

以下は今回の調査条件における結果であり、「200 空」を機能不存在、「403」を未認証、「500」を恒久的な利用不能と混同してはならない。

| 区分 | エンドポイント / 対象 | 調査結果と補足 |
| :--- | :--- | :--- |
| **200 空** | `/site/{siteId}/groups.json` | 確認したサイトでは空。グループ情報が存在しないとは一般化できない。 |
| **200 空** | `/sam_pub.json?siteId={siteId}`<br>`/sam_pub/context/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/sam_pub/describe)) | 確認したサイトでは空。Sakai 上流実装（[`PublishedAssessmentEntityProviderImpl.java`](https://github.com/sakaiproject/sakai/blob/5dc84ab5588662e202509cea3a6f5d3360a9da2d/samigo/samigo-services/src/java/org/sakaiproject/tool/assessment/entity/impl/PublishedAssessmentEntityProviderImpl.java)）では小テスト名称・説明・開始/締切等の扱いがあるが、KULMS での実データ構造や受験履歴・解答・点数の取得可否は未確認。 |
| **200 空** | `/chat-message.json?_locationReference=/site/{siteId}&items=10` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/chat-message/describe)) | 確認したサイトでは空。定義上は `body`, `owner`, `ownerDisplayName`, `messageDate`, `chatChannelId`, `context` 等を持つ（`context` クエリのみの指定は根拠としない）。 |
| **200 空** | `/mailarchive/siteMessages/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/mailarchive/describe)) | 確認したサイトでは空。定義上は `subject`, `body`, `createdOn`, `createdByDisplayName`, `headers`, `attachments` 等を持つ。 |
| **200 空** | `/webcontent/site/{siteId}.json`, `/lti/{siteId}/contents.json` | 確認したサイトでは空。 |
| **今回の条件では 500** | `/syllabus/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/syllabus/describe))<br>`/forums/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/forums/describe))<br>`/lessons/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/lessons/describe))<br>`/wiki/site/{siteId}.json` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/wiki/describe)) | 確認したサイトで HTTP 500（原因は未特定）。定義上はシラバス（本文・添付・外部 URL 転送）やフォーラム（forum/topic/message/添付の階層）等が存在する。 |
| **403 Forbidden** | `/membership/site/{siteId}.json`<br>`/user.json` | 確認したサイト・アカウント権限では 403。受講者名簿の取得や全学ユーザーの列挙は保証されない。 |
| **定義のみ確認 (`NOT_RUN`)** | `/dropbox/site/{siteId}/user/{eid}.json`<br>`/content/my.json`<br>`/profile/{userId}.json`<br>`/userPrefs/...`, `/session/...` | `/direct/{prefix}/describe` で定義のみ確認し、実取得は `NOT_RUN`（`profile` はプライバシー設定による取得範囲制限あり）。 |
| **定義のみ確認（成績簿）** | `/gbng/...` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/gbng/describe)) | 定義のみ確認。Sakai 上流実装（[`GradebookNgEntityProvider.java`](https://github.com/sakaiproject/sakai/blob/5dc84ab5588662e202509cea3a6f5d3360a9da2d/gradebookng/tool/src/java/org/sakaiproject/gradebookng/rest/GradebookNgEntityProvider.java)）では `comments` / `courseGradeComment` 等に教員・TA 権限検査があり、一般学生による成績簿全体・総合成績の取得可否は未確認。 |
| **操作対象外** | `/direct/feedback` ([describe](https://lms.gakusei.kyoto-u.ac.jp/direct/feedback/describe)) | ヘルプデスク等への報告用 PUT API であり、課題採点の `feedbackAttachments` 等とは無関係。実行していない。 |
| **未確認の情報** | 正式な時間割（曜日・時限）・教室・単位数・正式成績・出席/受講ログ | 今回の API 調査では取得を確認していない。 |

---

## 4. `kadai-hisho` 現行実装（YNU・模擬 LMS・共通契約）との項目別比較

現行コードベースの正本と KULMS API の対応関係を以下に示す。
- **共通型・上限・お知らせ制御**: [`packages/core/src/types.ts`](../packages/core/src/types.ts)、[`packages/server/src/observation-input.ts`](../packages/server/src/observation-input.ts)、[`packages/server/src/announcements/input.ts`](../packages/server/src/announcements/input.ts)、[`packages/server/src/announcements/store.ts`](../packages/server/src/announcements/store.ts)、[`packages/server/src/firebase.ts`](../packages/server/src/firebase.ts)、[`docs/data-shapes.md`](data-shapes.md)
- **YNU 実装**: [`packages/extension/src/collection.ts`](../packages/extension/src/collection.ts)、[`packages/extension/src/lms-request.ts`](../packages/extension/src/lms-request.ts)、[`lms-definitions/coursepower/navigation.json`](../lms-definitions/coursepower/navigation.json)、[`lms-definitions/coursepower/definition.json`](../lms-definitions/coursepower/definition.json)（実機確認記録: [`docs/records/2026-11-06-real-lms-check.md`](records/2026-11-06-real-lms-check.md) ※全件取得は partial、提出状態・面談全件照合・裏取得失敗試験は未完了）
- **模擬 LMS 実装**: [`packages/web/src/demo-reader.ts`](../packages/web/src/demo-reader.ts)、[`lms-definitions/demo-lms/definition.json`](../lms-definitions/demo-lms/definition.json)（検証記録: [`docs/records/2026-11-06-issue-66-verification.md`](records/2026-11-06-issue-66-verification.md)）

| 比較項目 | 共通契約 (`core` / `server`) | YNU (`ynu-lms` / CoursePower) | 模擬 LMS (`demo-lms`) | KULMS (Sakai `/direct` API) |
| :--- | :--- | :--- | :--- | :--- |
| **データ取得経路** | Observation 受信 API（授業上限 100・課題上限 200・受信 JSON 全体の上限 512KiB、未知フィールドはネスト含め拒否） | ログイン済み Cookie/SID で HTML 遷移（`doIndex` GET → `linkKougi` POST → `linkKyozaiTitle` POST）。課題提出 POST ではない | ブラウザ描画 DOM の `outerHTML` を HTML reader で解析 | SSO 認証後 HTTP セッションでの `/direct/*.json` GET（拡張機能からの統合は `NOT_RUN`） |
| **定義と変換器** | 構造化された `Observation` を受領 | CSS セレクター・正規表現（`lms-definitions/coursepower/`）。空・終端・次ページの印は未設定 | CSS セレクター（`lms-definitions/demo-lms/`）。明示的な空印・終端印あり | HTML セレクター定義の差し替えだけでは対応不可。JSON → `Observation` の専用アダプターが必要 |
| **授業 (`Course`)** | `courseId`, `name`, `slots[]`, 任意 `url` | ホーム HTML から授業 ID・授業名・曜日時限を抽出 | DOM から授業 ID・授業名・曜日時限を抽出 | `/site.json` の `id`, `title` 等。ただし正式履修以外のサイトも含む |
| **曜日・時限 (`slots`)** | `CourseSlot[]`（曜日・時限の配列） | ホーム HTML から抽出し `slots` に格納 | DOM から抽出し `slots` に格納 | 今回の API 調査では構造化された曜日・時限は未確認 |
| **担当教員** | `Course` 型にフィールドなし | 中間型 `ReadCourse.teacher` で読むが `Observation` へは渡さない | 中間結果のみで `Observation` へは渡さない | `/site.json` に `contactName` があるが未設定あり（現行契約では送信先なし） |
| **課題基本情報** | `sourceId`, `courseId`, `title`, `url` | 教材一覧の `REP` 行。`sourceId` は `${courseId}_${sourceId}` | DOM から抽出 | `/assignment/site/{siteId}.json` または `/assignment/my.json` の `id`, `context`, `title` 等 |
| **締切 (`deadline`)** | `datetime` / `date` / `none` / `unreadable` の 4 種 | `datetime` または `unreadable` のみ生成（教材一覧の公開期限は提出締切としない） | `datetime` または `unreadable` のみ生成 | `dueTime.epochSecond` 等（`openTime` / `closeTime` と区別し、`dropDeadTime` の意味は別途要確認。`null` を直ちに `none` としない） |
| **提出状態 (`submission`)** | `submitted` / `not-submitted` / `unknown` | HTML 表示から変換（「未評価」→`submitted` は保存見本の採取記録に依存） | DOM 表示から変換 | `submissions[]` の `submitted`, `status`, `draft` 等（配列欠落・未公開は `unknown` 扱いが必要） |
| **提出日時 (`submittedAt`)** | `Assignment` の任意フィールド | 現行 collector では未収集（出力しない） | 現行 collector では未収集（出力しない） | `submissions[].dateSubmittedEpochSeconds` / `dateSubmitted` で実値確認 |
| **課題本文・添付・採点・提出物** | `Observation` にフィールドなし（未知項目はサーバーが拒否） | 現行 collector では未収集 | 現行 collector では未収集 | `instructions`, `attachments`, `submittedText`, `submittedAttachments`, `grade`, `feedbackComment` 等で実値確認 |
| **お知らせ** | 別 API（`{system, courseId, announcement: {announcementId, version, publishedAt, body}}`）。入力スキーマ上は `'panda'` を許容するが、現行受領処理（[`store.ts`](../packages/server/src/announcements/store.ts), [`firebase.ts`](../packages/server/src/firebase.ts), [`data-shapes.md`](data-shapes.md)）は既定で無効（503）であり、有効時も `demo-lms` かつ体験学生本人以外は拒否（403）するため実 LMS は未対応 | 現行 collector では未収集 | 別 DOM 読み取りから専用 API へ送信（`ENABLE_DEMO_ANNOUNCEMENTS=true` 時のみ有効） | `/announcement/user.json` 等で HTML の `body`, `createdOn` 等を取得可能だが、フィールド変換だけでは接続不可（実 LMS お知らせの保持・同意・共有・費用・有効化方針が未合意であり未対応） |
| **LMS への書き込み操作** | 対象外（面談調整や計画のみアプリ内で管理） | 閲覧用 POST のみ。提出・取消等は未実装かつ現方針対象外 | 体験学生本人による模擬の先生役操作（締切延長・お知らせ投稿）のみ。支援担当の代理操作ではない | 読み取り GET のみ確認。提出・取消等は未実装かつ現方針対象外 |

---

## 5. 面談画面・Firestore 共有範囲との関わり

- **面談支援画面の前提**: [`packages/web/src/session-model.ts`](../packages/web/src/session-model.ts) および [`packages/web/src/session-page.tsx`](../packages/web/src/session-page.tsx) は、担当学生の次回面談までの締切、前回からの変更、要確認項目、取得状態、面談日時変更を表示する。空きコマ候補の表示はあるが、保存・学生への確認依頼は未実装である（[`PLAN.md`](../PLAN.md) の C24/C25 未完了）。
- **Firestore 共有ルールとの関係**: [`firestore.rules`](../firestore.rules) において、支援担当に対する既存の `scopes: all` 許可は `courses`, `assignments`, `changes`, `fetchStates`, `plans`, `sessionContext` の各コレクション文書を共有対象としている。仮に `assignments` 文書へ成績（`grade`）、採点コメント（`feedbackComment`）、提出本文（`submittedText`）等をそのまま追加すると、既存の権限設定のまま支援担当に見える情報範囲が広がることになる。また、アプリ内の支援担当への共有権限と、Sakai 上の閲覧・提出権限は独立している。

---

## 6. 今後の設計に向けた提案と要確認事項（未決）

以下は調査結果に基づく設計上の提案・論点であり、現時点での決定事項ではない。実装前に合意形成を要する。

1. **最小対応スコープと拡張情報の分離**
   - 最小対応としては、`/site.json` と `/assignment/...` から既存の `Observation` 契約（授業 ID・名称、`dueTime` からの `deadline`、明確な自身の提出状態からの `submission`、検証済みの提出時刻からの任意 `submittedAt`）へ変換する JSON アダプター構成が考えられる。
   - 授業資料（`/content`）、採点結果・講評、提出本文・添付ファイル等は、Observation 受信 API の受信 JSON 全体 512KiB 上限や未知フィールド拒否（[`packages/server/src/observation-input.ts`](../packages/server/src/observation-input.ts)）、および [`firestore.rules`](../firestore.rules) の共有範囲に関わるため、最小対応とは別の拡張として切り分け、共有方針を人間間で合意してから扱うべきである。
2. **曜日・時限（`slots`）が取得できない場合の扱い**
   - KULMS API から曜日・時限が取得できない場合、`slots: []` を「全コマが空いている」と解釈すると誤った空きコマ候補が生成される。現行の `Course.slots` 契約のままどのように「日時未知」を表現し、候補生成を抑止するか相談が必要である。
3. **締切種別・完全性フラグ（`listComplete`）・取消判定の扱い**
   - `openTime`（開始）・`dueTime`（締切）・`closeTime`（受付終了）を区別し（`dropDeadTime` の意味は別途要確認）、`dueTime` が `null` であることだけを根拠に `none`（締切なし）と断定しない。
   - API 応答から課題が見えなくなった原因が「公開期間終了・権限変更・期日フィルター・ページ分割上限」である可能性があるため、2 回連続不在による取消判定や `listComplete` に渡す取得範囲を固定し、フィルターや件数上限による欠落を課題取消と誤認しない設計が必要である。
4. **お知らせの未対応範囲と HTML 変換・`version` 契約（今回有効化しない）**
   - [`packages/server/src/announcements/input.ts`](../packages/server/src/announcements/input.ts) のスキーマ上は `'panda'` を許容していても、現行の受領処理（[`packages/server/src/announcements/store.ts`](../packages/server/src/announcements/store.ts) の `createAnnouncementStore` および [`packages/server/src/firebase.ts`](../packages/server/src/firebase.ts)）は `ENABLE_DEMO_ANNOUNCEMENTS=true` 時の `demo-lms`（体験学生本人）のみを受け付け、既定では `503`、実 LMS（`ynu-lms` / `panda`）は `403`（`AnnouncementForbidden`）で拒否する設計となっている（[`docs/data-shapes.md`](data-shapes.md) 144〜146 行）。
   - したがって、KULMS のお知らせは `/announcement` の `body`（HTML）変換や `version` の構成方法を定めるだけでは接続できない。実 LMS における実本文の保持条件・利用同意・共有範囲・費用と有効化方針について合意が必要な未対応範囲であり、今回は有効化せず、これらの扱いを要確認事項とする。

---

## 7. 検証境界

- 本書の KULMS API に関する結果は同セッションにおける先行調査の記録であり、本書追記時点での追加 API 実行および Chrome 拡張への統合試験は未実施（`NOT_RUN`）である。
- YNU LMS（CoursePower）および模擬 LMS（`demo-lms`）に関する記述は、比較対象コミット（`2732f359218a8167dd5264a48e36f0e74e0ec9e2`）のコードおよび既存の検証記録に基づく。
