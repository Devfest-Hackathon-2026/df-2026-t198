# データの形

Issue #16で実装した観測と台帳の契約。型の正本は [`types.ts`](../packages/core/src/types.ts)、受信時の検査は [`observation-input.ts`](../packages/server/src/observation-input.ts)。[設計案の2・3節](design.md#2-firestoreのデータの置き方と共有の範囲)を具体化する。未実装のカレンダーや共有は設計案を参照する。

## 体験用データ（Issue #19）

Issue #19の最新コメントとPR #30の合意1〜6を実装した。体験用の型は [`demo.ts`](../packages/core/src/demo.ts)。

- `demoAccounts/{uid}`：`role`（`student` / `supporter`）と、対応する学生の`studentId`。学生は`studentId === uid`。サーバー管理で、本人だけ読み取り可。
- `students/{uid}/demo/current`：`courses`配列。授業は`courseId`・`name`・`teacher`・`weekday`（月1〜日7）・`period`・`assignments`。課題は`sourceId`・`title`・`dueAt`（UTC、ミリ秒付きのISO日時）・`submission`。本人だけ読み取り可、支援担当にも直接見せない。台帳は従来の共有許可で見せる。
- `POST /api/v1/demo/extend`：Firebase ID tokenで認証し、`sourceId`と`expectedDueAt`だけを受け取る（上限2 KiB）。本人の学生プロフィールと一致する課題を確認し、期待した締切と等しい場合だけ1日延長。プロフィール・データの読み取りと更新を同じトランザクションで行う。成功は200で`{ sourceId, dueAt }`、不一致409、体験学生でない／課題がない場合403。未認証401、不正な本文400、サイズ超過413、JSON以外415、内部エラー500。すべて`Cache-Control: no-store`、エラーは固定コードのみ。
- 体験UIDの観測は`system: demo-lms`・`definitionId: demo-lms`だけを認める。支援担当や不正なプロフィールも403。プロフィール判定を台帳の保存トランザクション内で行い、再送でも判定する。プロフィールのない既存の利用者の観測契約は変えない。

体験用の文書へのクライアント書き込みは禁止。先生役のAPIは体験データだけを変え、描いたDOMのouterHTMLを既存のreaderで読んだ観測が届くまで台帳は変わらない。ブラウザ内の送信再試行は同じ観測IDを使い、再読み込み後の送信待ちは保持しない。初期設定と操作は [demo.md](demo.md) を参照。

## 観測（取得部品 → サーバー）

`POST /api/v1/observations` にJSONを送る。`Authorization: Bearer <Firebase ID token>` で認証し、保存先のuidは検証したtokenから決める。本文にuidやstudentIdは入れない。LMSのSID・Cookie・Googleのアクセストークンは送らない。

| 項目 | 内容 |
|---|---|
| `schemaVersion` | `1` |
| `observationId` | 取得1回のUUID（小文字）。再送では同じID、別の取得では新しいID |
| `system` | 接続先：`ynu-lms`、`panda`、`demo-lms` |
| `definitionId`、`definitionVersion` | 読み取りに使った定義のIDと正の整数の版 |
| `fetchedAt` | タイムゾーン付きISO 8601日時。表示と根拠に使い、順序の判定には使わない |
| `catalogCourses` | ホームで見つけた授業。`courseId`、`name`、`slots`（`weekday`: 月1〜日7、`period`: 1以上）、任意の `url`（授業の参照URL） |
| `courseResults` | 授業ごとの `courseId`、`listComplete`、`seenSourceIds`（一覧に存在した課題のID） |
| `assignments` | 詳細を読めた課題。下表 |
| `failures` | `courseId`（全体ならnull）、`kind`（`not-logged-in`・`http`・`parse`）、`detail`（固定コード） |

`courseResults` は `catalogCourses` にある授業だけを指す。課題はその授業の `seenSourceIds` に存在しなければならない。`sourceId` は同じ接続先の中で一意で、授業IDを含めてもよい。重複した授業・課題IDは拒否する。詳細を読めなかった課題は一覧のIDを残し、`assignments` に入れない。

| 課題の項目 | 内容 |
|---|---|
| `sourceId`、`courseId` | 課題と授業のID |
| `title` | 題名 |
| `url` | 認証情報を含まないHTTP(S)の参照URL。ユーザー名・パスワード・fragmentは不可 |
| `deadline` | 下の4種類。すべて `dueText`（画面の根拠）と `timeZone` を持つ |
| `submission` | `submitted`、`not-submitted`、`unknown` |
| `submittedAt` | 提出済みで時刻が分かるときだけ付ける |

締切の区別：

| `deadline.kind` | 追加の値 | 意味 |
|---|---|---|
| `datetime` | `dueAt`（タイムゾーン付き日時） | 時刻まで分かる |
| `date` | `date`（YYYY-MM-DD） | 日付だけ。23:59などを補わない |
| `none` | なし | 締切なしと明記されている |
| `unreadable` | なし | 読めなかった。前に確認した締切を消さない |

授業の `url` は課題と同じく認証情報を含まないHTTP(S) URLのみ。SIDなどを除いてから送信する。未取得なら項目を省略し、学生の授業欄にリンクを出さない。`courses/{courseKey}` にそのまま保存し、次の観測で省略された場合は以前のURLを残さない（Issue #41）。

### 受信時の検査

- 本文は512 KiBまで。授業と授業ごとの結果は各100件、課題と失敗は各200件、一覧のIDは1授業1,000件まで。文字列の長さも検査する。上限は分割受領の契約ではないため、超える場合は取得の契約を別途見直す。
- 日付の実在、日時のタイムゾーン、締切の種類と必要項目、曜日・時限（1〜24）を検査する。
- 未知の項目は入れ子も拒否する。SID等のパラメーター、認証用query、資格情報を含む文字列も拒否する。
- `failures.detail` は `not-logged-in`、`http-error`、`parse-error`、`list-incomplete`、`detail-unavailable` のいずれか。HTTP応答や例外の本文を転記しない。
- 任意の文章に紛れた未知の秘密の値を完全に識別できるものではない。取得側でも、SIDを含まない参照URLと許可した項目だけを組み立てる必要がある。

### 応答と再送

成功はHTTP 200で `{ status: 'applied', changed: boolean, changeCount: number }` を返す。`changed` は変更履歴を1件以上追加したか、`changeCount` はその件数。同じIDの再送には最初の結果をそのまま返すため、今回新たに変更した件数とは限らない。

認証失敗は401、不正な観測は400、本文サイズ超過は413、JSON以外は415、保存の失敗は500。エラーは固定コードだけを返し、入力やSDKのエラー内容は返さず、ログにも書かない。成功応答も `Cache-Control: no-store` にする。

Issue #16の指定に従い、今回は `sequence` と `payloadHash` を持たない。同じ学生について、同じ `observationId` は接続先にかかわらず同じ取得として扱い、内容が異なっても最初の結果を返す（409による衝突検出は未実装）。異なるIDは到着・トランザクションの処理順に適用する。1端末で取得と送信を1回ずつ終えてから次へ進む前提であり、古い観測を後から新しいIDで送ると値が戻り得る。

## 台帳と保存先

保存先は `students/{uid}` の下。書き込みはAdmin SDKを使うAPIだけが行う。今回はFirestoreの読み取り規則は変更せず、画面と支援担当の読み取りは別Issueで実装する。

| コレクション | 中身 |
|---|---|
| `courses/{courseKey}` | 授業の項目と `system` |
| `assignments/{key}` | `LedgerAssignment`。履歴の配列とカレンダーの予定IDを持たない |
| `changes/{changeId}` | 変更履歴。課題をまたいで読むため別文書にする |
| `fetchStates/{system}` | 最後の取得の状態 |
| `observationReceipts/{observationId}` | `observationId` と `result` だけ。観測全文は複製しない |

授業・課題の文書キーは `[system, sourceId]`（授業はcourseId）のJSONをSHA-256にした文字列。単純な文字の連結による衝突や、IDに含まれる `/` による別パスへの書き込みを避ける。

台帳の項目：

| 項目 | 内容 |
|---|---|
| `key` | `system` と `sourceId` |
| `latest` | 最後に詳細を読めた課題の観測。最新の読取結果と確かめ済みの値は区別する |
| `officialDeadline` | 最後に確認した `deadline` と `url`、`fetchedAt`、`observationId`。未確認ならnull |
| `submission`、`submittedAt` | 確かめた提出状態と時刻。`unknown` で既知の状態を消さない |
| `presenceState` | `active`、`cancellation-candidate`、`cancelled` |
| `consecutiveMissingCount` | 完全な一覧で連続して不在だった回数（0〜2、2で上限） |
| `lastSeenObservationId`、`lastSeenAt` | 一覧で最後に存在を確かめた根拠。詳細の失敗時も更新する |
| `reviewReasons` | 締切が読めない、文章と食い違うなど。読めない回に公式の締切を消さない |
| `preparationStartsAt` | 自動で出す準備の目安。今回はnull。確定した準備の予定とは別 |

変更履歴は `changeId`、`assignmentKey`、`kind`、`before`、`after`、`observationId`、サーバー時刻の `recordedAt`。種類は新規、題名の変更、締切の変更、提出、取消の候補、取消、再出現（`restored`）。日時の表記だけが変わって同じ時刻を指す場合は、締切の変更に数えない。

取消の回数は `listComplete: true` で不在のときだけ進める。不完全な一覧は回数を進めず、一覧に再びあれば0に戻す。詳細の失敗は不在とみなさない。候補・取消から再出現したときはactiveに戻し、履歴を残す。提出状態は取消状態と独立して保持する。

取得状態は `studentId`、`system`、`lastAttemptedAt`、`lastSucceededAt`、`lastFailureKind`、`lastResult`（`success`・`partial`・`failed`）、`lastAppliedObservationId`。全授業の一覧・存在した課題の詳細を取得でき、失敗がない回だけ成功時刻を更新する。一部成功や失敗で以前の成功時刻を消さない。

APIは受領記録、授業、台帳、履歴、取得状態を1つのFirestoreトランザクションで保存する。再送では文書の更新時刻も変えない。カレンダーやGeminiの呼び出しは含めない。coreの `applyObservation` はI/Oなしで更新を計算し、既存の受領記録が渡されたときは適用を行わない。

## 準備の予定と既存の読み取り部品

`PreparationPlan` はまだ従来の雛形（課題、日付、時限、面談日、カレンダーの予定ID）。本人の確定や同期待ちを扱う型への変更は、このIssueには含めない。

HTML読み取り部品の中間結果 `ReadAssignment` は観測の送信形とは別。従来の `dueAt`・`dueText` を持ち、取得部品が根拠に応じて上の `deadline` に変換する。`dueAt: null` だけから締切なしとは判断しない。`stripSessionId` はpathの `;SID=...` を除く既存の補助で、queryなどを含む一般的な秘密除去ではない。

## 面談日時と担当する学生（Issue #21）

`SessionContext` は `lastSessionAt`・`nextSessionAt` の2項目。どちらもタイムゾーン付きISO 8601日時、未設定なら `null`。保存先は `students/{uid}/sessionContext/current`。APIは実在する日付・時刻・時差を検査し、両方の項目を必須にして、未知の項目を拒否する。未設定の期間を画面が推測することはない。

- `GET /api/v1/supporter/students`：Firebase ID tokenで認証した支援担当について、許可文書の `scopes` がリストで `all` を含み、`revokedAt` が明示的に `null` の学生だけを `{ students: [{ uid }] }` で返す。学生の表示名やメールは返さない。全学生の一覧をクライアントから問い合わせる規則は追加しない。
- `PUT /api/v1/students/{uid}/session-context`：本文は `SessionContext`、上限2 KiB。支援担当への許可の読み取りと日時の上書きを同じFirestoreトランザクションで行う。許可がない場合は本人でも403。成功時は保存した2項目を200で返す。
- どちらも既存のID token検証（失効確認付き）を使い、応答に `Cache-Control: no-store` を付ける。未認証401、不正な本文400、サイズ超過413、JSON以外415、保存失敗500。エラーは固定コードのみ。実物の入力やSDKの例外を応答・ログに出さない。

画面は許可文書をサーバーから確認してから、授業・課題・変更・更新状態・面談日時を購読する。許可の取消・削除、購読失敗で内容を消し、購読を止める。学生切替・ログアウトでも前の学生の表示と購読を破棄し、遅れて届いた通知で復活させない。台帳の永続キャッシュは作らない。通信が切れている間の取消を即座に検知したり、すでに渡した情報を回収したりするものではない。

締切の表示期間は現在から次の面談日時まで（両端を含む）。日付だけの締切は、その締切の `timeZone` での今日から面談日までを含め、時刻を補わない。提出済み・取消済みはこの一覧から外す。前回からの変化は、前回の面談日時より後、現在までの変更を新しい順に出す。要確認は締切の表示期間と独立して「今日決めること」にまとめる。3日以上更新がない接続先と、一部しか確認できなかった接続先には更新状況を添える。
