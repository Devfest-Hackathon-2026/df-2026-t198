# KULASIS 取得データ調査および LMS 4方式比較

## 1. 調査概要と比較対象

- **調査日**: 2026-11-07
- **位置づけ**: 京都大学の教務情報システム（KULASIS）について、実環境での HTTP GET/HEAD による HTML 画面・ヘッダー取得結果を整理し、既存の YNU / CoursePower、ダミー LMS、および先行調査済みの KULMS（Sakai REST API）と比較する文書である。
- **文書の境界**: 本稿は調査知見の文書化のみを目的とし、API・共通型・依存関係・権限・実装の変更や決定は行わない。また、[PLAN.md](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/PLAN.md) の完成条件を完了扱いにするものでもない。新実装を行う場合は調査前に書かれた外部コードの転用ではなく、本文書に記録された知見を根拠とする。
- **安全と秘匿**: 調査時はログイン操作を除き閲覧系の GET と添付確認の HEAD のみを実施し、履修登録・取消、課題提出、登録情報変更等の更新操作は一切行っていない（本文書追加時も実サービスへの追加操作はなし）。本稿には個人 ID、実授業名、教員名、通知本文、点数、実ファイル名、実アカウントの件数、Cookie、認証トークン、アクセスキー、セッション ID、認証 URL の実値、および実応答・HTML 原文は記載せず、汎用フィールド名と URL テンプレートのみを記録する。

### 比較元の版と参照先

- **先行 KULMS 調査**: [docs/kulms-api-comparison.md](./kulms-api-comparison.md)（2026-11-06 時点、`2732f359218a8167dd5264a48e36f0e74e0ec9e2` の記録）
- **本稿の現行コード比較元**: 2026-11-07 時点の `origin/main`（固定コミット `00c0bf771a9f909a4aa4d87d035e930b9144c7ee`）。版を固定して比較するため、現行実装の参照には GitHub 固定コミット URL を用いる。
  - 現行契約・台帳・読取定義: [types.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/types.ts)、[definition.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/definition.ts)、[observation-input.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/observation-input.ts)、[ledger.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/ledger.ts)、[observation-store.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/observation-store.ts)
  - YNU 収集・読取・拡張設定: [manifest.json](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/extension/manifest.json)、[collection.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/extension/src/collection.ts)、[lms-request.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/extension/src/lms-request.ts)、[collection-worker.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/extension/src/collection-worker.ts)、[coursepower/definition.json](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/lms-definitions/coursepower/definition.json)、[html-reader.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/html-reader.ts)
  - ダミー LMS: [demo-reader.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/web/src/demo-reader.ts)、[demo-lms/definition.json](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/lms-definitions/demo-lms/definition.json)、[demo.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/demo.ts)
  - お知らせ・基盤: [announcements/input.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/announcements/input.ts)、[announcements/store.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/announcements/store.ts)、[firebase.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/firebase.ts)
  - 検証・同期記録: [2026-11-07-integrated-live-verification.md](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/docs/records/2026-11-07-integrated-live-verification.md)（`e331dde` 版での C04/C05 通常取得・学生操作後・worker 通信停止時のページ側取得の success 記録。直近 `00c0bf7` で入った学生操作中断後の完読授業再利用 checkpoint 変更の実機証拠とは同一視しない。C43 の実物通し・動画等は未完了）、[2026-11-06-issue-66-verification.md](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/docs/records/2026-11-06-issue-66-verification.md)、[2026-11-07-issue-129-sync.md](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/docs/records/2026-11-07-issue-129-sync.md)

---

## 2. KULASIS の認証経路とベース URL

- **SSO 経路**: 既存の ECS-ID / パスワード / TOTP を用い、`https://student.iimc.kyoto-u.ac.jp/login.html` → `/list.html` → ポータル内リンク `https://www.k.kyoto-u.ac.jp/student/la/top` へ遷移し、所属に対応する画面から本人の時間割等の HTML 取得に成功した。
- **セッションの扱い**: KULMS と同じ資格情報で SSO できることを確認したが、KULASIS 側のサービスセッションを確立する必要があり、KULMS の Cookie をそのまま使い回せることを確認したわけではない。調査は HTTP プロセス内でのみ行い、取得データおよび Cookie はリポジトリへ保存していない。
- **ベース URL とスコープ**: `https://www.k.kyoto-u.ac.jp/student/{部局}`（`{部局}` は `la`、`u/t`、`g/i` 等の部局別パス）。以下は調査対象とした部局・アカウントでの HTML 画面取得結果であり、全学のすべての部局・学生での同一構造や全機能を保証するものではない。また、公開 JSON API の有無は未確認であり、HTML 画面のパスを安定した公開 API 契約と断定しない。`no` 等の識別子は画面内リンクから取得したものであり、推測列挙は行っていない。

---

## 3. KULASIS 取得先とフィールド一覧

パスは原則として `https://www.k.kyoto-u.ac.jp/student/{部局}` に対する相対パスである（サイトルート起点のパスや外部ホスト URL は表内に明記）。実 LMS において対象画面で要素が得られなかったものは「サービス上に情報が存在しない」のではなく「対象の授業・区分で空」または「今回取得未確認 / `NOT_RUN`」として区別する。

| 区分 | パス / テンプレート | 状態 | 確認したフィールド・パラメータ・備考 |
| :--- | :--- | :--- | :--- |
| 時間割（前・後期） | `/entry/zenki`<br>`/entry/kouki` | 取得済み（HTML GET） | 本人に表示される前期・後期の授業名、曜日、時限、授業サポートへのリンク。構造化 JSON ではなく HTML 表。縦横入替表示（`timetable_type`）があるため固定セル位置のみに依存した読取は危険。時限番号と実時刻は別管理。全学共通科目と専門科目等の部局横断・全件性は未確定。 |
| 授業基本情報 | `/support/top?no={授業ID}` | 取得済み（HTML GET） | 科目名、対象学科・専攻、開講期、曜時限、担当教員。シラバス詳細、授業資料、レポート、授業連絡メールへの各リンク。 |
| KULMS 科目別リンク | `https://lms.gakusei.kyoto-u.ac.jp/direct/courselink/_kcd={科目コード}` | リンク取得済み / 突合 `NOT_RUN` | `/support/top?no={授業ID}` 内に存在を確認。KULASIS 内部 `no`、ナンバリング、講義コード、`_kcd`、KULMS（Sakai）の `siteId` がすべて同一 ID 体系とは断定できない。授業対応付けの有力な候補情報だが、全件突合およびリンク先 API での検証は `NOT_RUN`。 |
| シラバス検索入口・実行 | `/syllabus/top`<br>`/syllabus/search` | 取得済み（HTML GET） | 検索フォームおよび日本語での科目検索成功を確認。主な検索キーの代表例: `condition.semester`（`1`前期 / `2`後期 / `4`前期集中 / `5`後期集中 / `6`通年集中）、`condition.weekSchedule[11]` 等（曜日×時限）、`condition.courseTitle`、`condition.teacherName`、`condition.keyword`、`condition.syutyu`、`condition.disciplineNo` 等（ほかにナンバリング・実務経験等の条件項目あり）。結果画面で `page`、`condition.itemInPage` によるページ・件数指定リンクを確認（全ページ走査は未実施）。 |
| シラバス詳細 | `/syllabus/detail?no={ID}`<br>`/support/syllabus_detail?no={ID}` | 取得済み（HTML GET） | 検索結果および履修授業サポートの双方から本文を取得。確認項目: 科目名・英訳、ナンバリング、教員氏名・所属部局・職名、配当学年、単位数、開講年度・開講期、曜時限、教室、授業形態、使用言語、概要・目的、到達目標、授業計画・内容、成績評価の方法・観点、履修要件、教科書、参考書、授業外学修（予習復習）、その他（オフィスアワー等）。未記入項目あり。「成績評価の方法」はシラバス上の基準であり本人の点数・成績ではない。 |
| 教務・厚生お知らせ一覧 | `/global_notice/top`<br>`/global_notice/general` | 取得済み（HTML GET） / 一部区分は対象で空 | `/global_notice/top` で分類・区分一覧と新着、`/global_notice/general` で過去分を含む一覧画面を取得（全件性は未確認）。「学生呼び出し」「授業変更」「休講」「補講」「授業連絡」「レポート課題・連絡」の区分を確認したが、調査対象では空（「発行されていません」等の明示表示）の区分があり、空区分の個別詳細項目は未確定。 |
| 教務・厚生お知らせ詳細 | `/global_notice/general_detail_zengaku?dbName={部局DB}&noticeGeneralNo={通知ID}` | 取得済み（HTML GET） | 実データで分類、件名、対象、本文、添付ファイル名とリンクを確認。識別子は `dbName`（部局 DB）の文脈を伴うため、単一の番号のみを全学・全サービス共通 ID とは扱えない。特定授業に紐づかない全学・部局通知も含まれる。 |
| 教務・厚生お知らせ添付 | `/global_notice/general_attachment?dbName={部局DB}&no={添付ID}` | `HEAD 200` 確認 / 本体 `NOT_RUN` | `Content-Type: application/pdf`、ファイル名付きの `Content-Disposition` を確認。PDF 本体の GET・保存・本文解析は `NOT_RUN`。 |
| 全学の掲示・詳細・添付 | `/top`<br>`/information_detail?no={通知ID}`<br>`/information_attachment?no={添付ID}` | 詳細取得済み / 添付 `HEAD` は `NOT_RUN` | `/information_detail?no={通知ID}` で本文、対象学部・研究科、掲示期間、添付リンクを取得。`/information_attachment?no={添付ID}` はリンク存在のみ確認（`HEAD` および本体取得は `NOT_RUN`）。 |
| 授業資料・レポート・授業連絡メール | `/support/lecture_material_list?no={授業ID}`<br>`/support/report_list?no={授業ID}`<br>`/support/course_mail_list?no={授業ID}`<br>`/course_mail_list?semesterNo={学期}` | 画面到達・対象授業で空 | 各一覧およびその学期の授業横断メール一覧に到達したが、調査対象の授業・学期では該当データが空であった。したがって、KULASIS 上に存在する課題の締切・提出状況・提出日時を実データで読み取れたとは主張できない。 |
| オフィスアワー検索 | `/student/la/oh/top`（サイトルート起点） | 入口確認 / 結果詳細 `NOT_RUN` | 他の相対パスと異なり `https://www.k.kyoto-u.ac.jp` 直下のサイトルート起点パス（`/student/{部局}` に重ねない）。教員名・カナ・所属による検索フォーム入口まで確認。検索実行後の結果詳細は `NOT_RUN`。 |
| その他の教務情報・更新系操作 | 個人成績、試験時間割、出席・受講ログ、履修登録・取消、課題提出、登録情報変更 | 今回未確認 / `NOT_RUN` | 個人成績や試験時間割などは公式機能案内に記載がある一方、出席・受講ログの機能存在も含め今回の実測では未確認。また変更・提出系の操作は一切実行していない。 |
| 拡張機能・システム統合一式 | Chrome 拡張経由取得、CORS / `SameSite` 挙動、長期認証、全件・過去学期走査、観測送信・共有台帳・Google 同期 | `NOT_RUN` | 今回は調査用 HTTP セッションでの単発確認のみであり、ブラウザ拡張からの実行やアプリ本体への接続は未実施。 |

---

## 4. 実装上の観測事実（技術的注意点）

### A. 遅延 `meta refresh` による即時ログアウト現象

- **現象**: 調査時に使用した既存の共通認証処理が、認証後の HTML 内に含まれる遅延 `meta refresh`（1800 秒後に `/student/logout` へ遷移するセッションタイムアウト用指定）を即時リダイレクトとして追跡してしまい、認証済み画面の取得直後にログアウトする事象が発生した。
- **原因の切り分けと対処**: ログイン資格情報の誤りや入口 URL の誤りが原因ではなかった。調査プロセス内で遅延指定付きの `meta refresh` を即時追跡しないよう制御することで、各画面の閲覧に成功した（恒久修正は行っていない）。
- **位置づけ**: これは調査用補助処理での観測事実であり、`kadai-hisho` の現行コードで同一バグが再現したという主張ではない。今後 KULASIS 向け読取を実装する際は、認証途中の即時遷移とログイン後のタイムアウト用タイマー遷移を明確に区別する必要がある。

### B. 文字コード（`windows-31j` / CP932）の decode と encode

- **現象**: KULASIS の HTML 応答の `Content-Type` 文字コードは `windows-31j` である。また、`/syllabus/search` における日本語の科目検索条件について、同一文字列を UTF-8 で URL エンコードした場合は 0 件となり、CP932（`windows-31j`）でエンコードした場合に正しくヒットした。
- **設計上の注意**: HTML 応答の decode と検索パラメータの encode を分けて扱う必要がある。Unicode 文字列を受け取る現行の HTML reader 等へ渡す前に適切な decode が必要であり、また標準の `URLSearchParams` をそのまま用いるだけでは CP932 エンコード検索は実現できない（ただし全エンドポイントが同一仕様であると無条件に一般化はしない）。

---

## 5. 4方式データ比較（YNU / ダミー LMS / KULMS / KULASIS）

- **YNU 欄の前提**: CoursePower 製品全体の機能上限ではなく、`00c0bf7` 時点の現有 collector / reader が共通観測モデルへ運ぶ範囲を示す。現行実装では今学期判定・過去学期の収集抑止、公開終了・期限終了等の `endedSourceIds` 反映、空教材一覧や `24:00` 表記の読取修正、および準備予定保存・手入力課題等の共通機能が実装済みである（2026-11-06 時点の旧記述を引き継がない）。
- **ダミー LMS の前提**: Firestore 上の架空データを DOM に描画し、`outerHTML` を共通 reader で読み取って共通観測へ送る。お知らせは別 DOM から別 API へ送信する。先生役による締切延長や通知投稿は体験学生本人の操作であり、支援担当による実 LMS の代理操作ではない。

| 項目 | YNU / CoursePower（現行実装 `00c0bf7`） | ダミー LMS（現行実装 `00c0bf7`） | KULMS / Sakai API（11/6 実測・未接続） | KULASIS（11/7 HTML 実測・未接続） |
| :--- | :--- | :--- | :--- | :--- |
| **取得方式** | ブラウザ拡張（ログイン済み Cookie / SID）で HTML 取得 → 共通 `html-reader` | 画面描画 DOM の `outerHTML` → 共通 `html-reader`（お知らせは別経路） | HTTP セッションで JSON REST API（`/direct/...`）取得 | HTTP セッションで HTML GET / HEAD（`windows-31j`） |
| **kadai-hisho 接続状況** | 接続済み（`ynu-lms`）。`e331dde` で C04/C05 実機検証記録あり | 接続済み（`demo-lms`） | 未接続（`panda` は型定義のみ、実コネクター未実装） | 未接続（`LmsSystem` に `kulasis` 未定義、reader 未実装） |
| **授業名 (`Course.name`)** | 取得・観測出力あり | 取得・観測出力あり | 取得確認済み（`/direct/site.json` 等） | 取得確認済み（時間割・授業サポート・シラバス） |
| **曜日・時限 (`Course.slots`)** | 取得・観測出力あり | 取得・観測出力あり | 11/6 調査範囲では API 項目未確認 | 取得確認済み（`/entry/zenki`、`/entry/kouki` 等。時限番号と実時刻は別） |
| **担当教員・単位・教室・シラバス本文** | `ReadCourse.teacher` は中間結果のみ（共通 `Course` 契約外のため観測非出力） | `teacher` は中間結果のみ（観測非出力） | 11/6 調査範囲では時間割・教室等は未確認 | シラバス詳細・授業基本情報で教員・単位・教室・評価方法・計画等を取得確認（現行 `Course` 契約外） |
| **今学期判定 (`currentTerm`)** | 実装済み（過去学期は収集抑止・`currentTerm=false` 扱い） | 現行collectorは未判定・未出力 | 未接続 | 前期/後期画面や開講期表示を確認（共通型への変換規則は未決） |
| **課題一覧・締切 (`deadline`)** | 取得・観測出力あり（`datetime` / `unreadable`、`sourceId` は `courseId`+教材ID） | 取得・観測出力あり（`datetime` / `unreadable`、明示的空印・終端印あり） | JSON API で課題名・日時締切の取得確認済み | `/support/report_list` 等に到達したが調査対象授業で空（実課題の締切読取は未確認） |
| **提出状態 (`submission`) / 提出日時 (`submittedAt`)** | `submitted` / `not-submitted` / `unknown` を出力。`submittedAt` は非出力 | `submission` を出力。`submittedAt` は非出力 | JSON API で提出状態・提出日時・自己提出本文・採点結果の取得確認済み | 対象授業でレポート一覧が空のため実データ未確認 |
| **公開終了・終端課題 (`endedSourceIds`)** | 公開終了・期限終了等を `endedSourceIds` として出力 | `endedSourceIds` 未出力（一覧終端印は `listComplete` 判定に使用） | 未接続 | 未確認 |
| **お知らせ・通知** | 共通観測契約外 | 別 DOM からお知らせ専用 API へ送信（体験学生本人のみ受付） | `/direct/announcement/...` で件名・本文等の取得確認済み | 全学掲示・教務厚生通知（件名・本文・PDF 添付 `HEAD 200`）・授業連絡メール枠を確認 |
| **授業資料・添付ファイル** | 課題回収用のため教材一覧から課題を抽出 | 課題・お知らせ中心 | Content / Resources API で資料一覧取得確認済み | `/support/lecture_material_list` は対象授業で空。通知添付 PDF は `HEAD 200` 確認（本体 GET は `NOT_RUN`） |
| **システム間リンク** | 単一 LMS 内で完結 | 単一 LMS 内で完結 | サイト ID（`siteId`）単位 | 授業サポート内に KULMS への `/direct/courselink/_kcd={科目コード}` を確認（全件突合は `NOT_RUN`） |

---

## 6. 現行契約との対応と未決事項（設計上の論点）

KULASIS の知見を将来 `kadai-hisho` に統合する場合、現行の型・サーバー検証・台帳ロジック（`00c0bf7` 時点）との間に以下の論点が存在する。本稿ではこれらを未決事項として記録し、現時点での仕様変更は行わない。

1. **`LmsSystem` 識別子と観測モデルの扱い**
   - 現行の [types.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/types.ts) および [observation-input.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/observation-input.ts) では、`LmsSystem` は `ynu-lms | panda | demo-lms` の 3 値であり、未知の値や未知のネストフィールドはサーバーで拒否される。
   - KULASIS を独立した `LmsSystem` として追加するか、KULMS（`panda`）観測の補助ソースとして統合するかは未決であり、型および API 変更の合意が必要である。
2. **既存読取定義（`ReadingDefinition`）と拡張機能権限のギャップ**
   - [definition.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/definition.ts) において、現行の `ReadingDefinition` が持つ画面種別は `home` / `materials` / `assignmentDetail` の 3 種類であり、シラバスや教務通知に対応する型は存在しない。また、値抽出契約である `ValueRule.attribute` は `'id' | 'onclick'` のみで `'href'` には未対応であり、`courses.materialsLink` / `materials.detailLink` / `materials.nextPage` は `null` 固定となっている。
   - そのため、今回 KULASIS の画面内リンクから読み取ったクエリ ID（`?no=` 等）や縦横切替（`timetable_type`）を伴う時間割表を現行定義でそのまま扱える保証はなく、単に `definition.json` を追加するだけで接続可能とは言えない。
   - さらに、[manifest.json](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/extension/manifest.json) の `content_scripts` 対象ホストは YNU のみであり、KULASIS ホストでの起動・取得経路も未実装である。どの範囲で型・reader・権限を変更するかの特定は将来の実装検証課題とし、今回は型・API・権限の変更を行わない。
3. **台帳（Ledger）の誤取消リスクと `listComplete` の条件**
   - [ledger.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/core/src/ledger.ts) の仕様上、終了扱い（`ended` 等）でない既存課題が、同一 `system` / `courseId` の完全な一覧（`listComplete: true`）で連続して見えなくなる場合、1 回で取消候補、2 回連続で取消（`cancelled`）へ遷移する。
   - もし KULASIS で時間割のみを取得し、課題を読み取らないまま `listComplete: true` かつ `seenSourceIds: []` として既存の `panda` 授業 ID へ送信すると、KULMS 側で観測済みの課題を誤って取消にする危険がある（授業 ID の対応付けが存在しない段階では同一 `courseId` にならないため発生しないが、将来統合する際の重要な制約である。なお、これは現行仕様から導かれる設計上の注意であり、実際に発生した不具合ではない）。
4. **`Course` 保存の上書き問題と属性の契約範囲**
   - [observation-store.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/observation-store.ts) では、`system` / `courseId` 単位で観測された `Course` オブジェクトを置換保存する。別観測として同一キーへ KULASIS 情報を送ると、補完の意図であっても既存の `url` や `currentTerm` 等の属性を欠落させる恐れがあるため、統合方法・出典・優先順位の事前定義が必要である。
   - また、現行 `Course` は `courseId, name, slots, url?, currentTerm?` のみであり、教員名・単位・教室・シラバス本文は契約外である。シラバスの「到達目標」や「成績評価の方法」は科目の説明であり、`Assignment` の課題本文や提出状態（`submission`）とは異なる。
5. **KULMS との科目対応付けと時間割補完の条件**
   - KULMS の課題情報に KULASIS の曜日・時限を補完する構成は有望だが、`/direct/courselink/_kcd={科目コード}` のリンク先検証、KULASIS 内部 `no`・ナンバリング・講義コード・`_kcd`・Sakai `siteId` の関係整理、部局・年度・学期ごとの完全性確認、時限番号から実時刻への変換定義が前提となる。
   - 科目名の一致のみに頼る自動結合は避け、「授業が存在しない」「未取得・取得失敗」「過去学期」を明確に区別し、時間割未取得を空きコマとして扱わない設計が必要である。
6. **お知らせ API とのギャップ**
   - [announcements/input.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/announcements/input.ts) のスキーマ上は `panda` 等も定義に含まれるが、[announcements/store.ts](https://github.com/shieikan/kadai-hisho/blob/00c0bf771a9f909a4aa4d87d035e930b9144c7ee/packages/server/src/announcements/store.ts) の `createAnnouncementStore` は `demo-lms` の体験学生本人のみを受け付け、機能有効化前は `503`、実 LMS からの入力は `403` となる。
   - KULASIS の通知には特定授業（`courseId`）に紐づかない全学・部局通知があり、`version` や `publishedAt`、課題との対応も保証されないため、本文をそのまま既存 API に送信して即時接続することはできない。本文保持・共有範囲・費用・有効化条件の検討が必要であり、かつ「公式の課題締切をお知らせ本文で自動上書きしない」方針を維持する。
7. **認証方式と支援担当の権限境界**
   - 支援担当者は学生本人の資格情報で大学システムへログインするのではなく、学生が許可したアプリの共有台帳を閲覧する設計である。
   - 今回の調査で HTTP プロセスからの SSO ログインに成功したことは、パスワードや TOTP シードのサーバー保存・自動ログインを採用する根拠にはならない。実運用では学生本人のブラウザにおけるログイン済み状態を利用する基本方針を維持する。

---

## 7. 出典・関連資料

- 京都大学 情報環境機構 学生向けポータル・KULASIS 案内: <https://www.iimc.kyoto-u.ac.jp/ja/services/portal/student>
- 京都大学 大学から学生への連絡方針: <https://www.kyoto-u.ac.jp/ja/education-campus/cli/renraku>
- 京都大学 文学部・文学研究科 学生向け機能案内資料（KULASIS 機能概要の参考資料であり、個人成績等の実測証拠ではない）: <https://www.bun.kyoto-u.ac.jp/wp-content/uploads/bun-student-handbook.pdf>
- 調査時の認証経路確認で参照した外部資料（[`ku_auth_helper` README](https://github.com/orangeToT/ku_auth_helper/blob/723d775ab71098dc6718c2d3ffa7093d6aa5cf61/README.md)）の扱い・ライセンス区分については、[docs/third-party.md](./third-party.md) を参照。コードの複製・同梱・依存導入は行っておらず、新実装の入力ソースとしても使用しない。
