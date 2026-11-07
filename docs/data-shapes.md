# データの形

Issue #16で実装した観測と台帳の契約。型の正本は [`types.ts`](../packages/core/src/types.ts)、受信時の検査は [`observation-input.ts`](../packages/server/src/observation-input.ts)。[設計案の2・3節](design.md#2-firestoreのデータの置き方と共有の範囲)を具体化する。カレンダー同期は本書の末尾、未実装の共有の操作は設計案を参照する。

## 体験用データ（Issue #19）

Issue #19の最新コメントとPR #30の合意1〜6を実装した。体験用の型は [`demo.ts`](../packages/core/src/demo.ts)。

- `demoAccounts/{uid}`：`role`（`student` / `supporter`）と、対応する学生の`studentId`。体験学生には任意の `displayName`（架空の名前）があり、seedとリセットは `initialDemo` の同じ名前を使う。学生は`studentId === uid`。サーバー管理で、本人だけ読み取り可。
- `students/{uid}/demo/current`：`courses`配列。授業は`courseId`・`name`・`teacher`・`weekday`（月1〜日7）・`period`・`assignments`。課題は`sourceId`・`title`・`dueAt`（UTC、ミリ秒付きのISO日時）・`submission`。本人だけ読み取り可、支援担当にも直接見せない。台帳は従来の共有許可で見せる。
- `POST /api/v1/demo/extend`：Firebase ID tokenで認証し、`sourceId`と`expectedDueAt`だけを受け取る（上限2 KiB）。本人の学生プロフィールと一致する課題を確認し、期待した締切と等しい場合だけ1日延長。プロフィール・データの読み取りと更新を同じトランザクションで行う。成功は200で`{ sourceId, dueAt }`、不一致409、体験学生でない／課題がない場合403。未認証401、不正な本文400、サイズ超過413、JSON以外415、内部エラー500。すべて`Cache-Control: no-store`、エラーは固定コードのみ。
- `POST /api/v1/demo/announce`（Issue #84）：延長APIと同じ認証・本文・上限・エラー形式。本人の体験学生の未提出課題と期待する締切を同じトランザクションで確認し、サーバーが架空の締切延長文を作る。日時は操作時刻+4日と課題の締切+1日の遅い側の日本時間17時。成功は200で `{ announcementId }`。課題の締切と台帳は変えない。
- 体験データの任意の `announcements` 配列は `{ courseId, announcement: { announcementId, version, publishedAt, body } }`。既存データで省略されていれば空として読む。授業ごとに最新1件、IDは投稿ごとに新しいUUID、版は `1`、公開日時は秒まで。架空の本文を保存するのは本人だけの体験用LMS文書に限り、解析APIの受領記録やログには複製しない。「LMSを開く」は描かれたDOMから読み、観測を送った後で既存のお知らせAPIへ別送する。解析の失敗で課題の更新は戻さない。
- `POST /api/v1/demo/reset`（Issue #68）：認証・本文上限・エラー形式は上の延長APIと同じ。本文は `{ onlyIfStale: boolean }` だけ。`false` は常に初期化、`true` は初回表示時に締切か次の面談が過去／不正／未設定なら初期化する。新しい場合は進行中の体験を保つ。応答は200で `{ reset: boolean, data: DemoData }`。
- リセットは本人の体験学生プロフィールと元データを同じトランザクションで確認する。授業を初期の架空シナリオへ戻し、締切は操作日+3日の日本時間17時、前回／次回面談は操作日の−7日／+7日の平日15:00（日本時間）。操作日が土日なら直前の金曜を基点にする（Issue #129）。`assignments`・`courses`・`changes`・`fetchStates`・`observationReceipts`・`calendarItems` と体験用の `integrations/calendar` を消す。共有許可とアカウント、他の学生は変えない。支援担当・通常利用者・不正なプロフィール・実物カレンダーの接続がある場合は403。少量の架空データ向けで、同じ組の同時利用は同じ体験を共有する。
- やり直すと `announcements` も空に戻る。解析の受領記録と全体の費用予約は消さない。新しい投稿IDにより、やり直し後も新しい架空のお知らせを処理できる。同じ体験アカウントでの並行操作は従来どおり同じ体験を共有する。
- 体験UIDの観測は`system: demo-lms`・`definitionId: demo-lms`だけを認める。支援担当や不正なプロフィールも403。プロフィール判定を台帳の保存トランザクション内で行い、再送でも判定する。プロフィールのない既存の利用者の観測契約は変えない。
- カレンダーAPI（`GET/POST /api/v1/calendar-sync`）は`demoAccounts/{uid}`のある利用者を403で拒否する。接続・同期対象の取得・結果報告の各トランザクションの先頭で確認する。画面のボタンを隠すだけにはしない。

体験用の文書へのクライアント書き込みは禁止。先生役の延長APIは体験データだけを変え、描いたDOMのouterHTMLを既存のreaderで読んだ観測が届くまで台帳は変わらない。ブラウザ内の送信再試行は通信失敗と5xxに限り、同じ観測IDを使う。4xxでは送信待ちを破棄してアカウントの設定確認を促す。延長は応答の締切が購読で画面に届くまで次の読み取りを止める。再読み込み後の送信待ちは保持しない。初期設定と操作は [demo.md](demo.md) を参照。

## 観測（取得部品 → サーバー）

`POST /api/v1/observations` にJSONを送る。`Authorization: Bearer <Firebase ID token>` で認証し、保存先のuidは検証したtokenから決める。本文にuidやstudentIdは入れない。LMSのSID・Cookie・Googleのアクセストークンは送らない。

| 項目 | 内容 |
|---|---|
| `schemaVersion` | `1` |
| `observationId` | 取得1回のUUID（小文字）。再送では同じID、別の取得では新しいID |
| `system` | 接続先：`ynu-lms`、`panda`、`demo-lms` |
| `definitionId`、`definitionVersion` | 読み取りに使った定義のIDと正の整数の版 |
| `fetchedAt` | タイムゾーン付きISO 8601日時。表示と根拠に使い、順序の判定には使わない |
| `catalogCourses` | ホームで見つけた授業。`courseId`、`name`、`slots`（`weekday`: 月1〜日7、`period`: 1以上）、任意の `url`（授業の参照URL）、任意の `currentTerm`（今の学期か。省略はtrue） |
| `courseResults` | 授業ごとの `courseId`、`listComplete`、`seenSourceIds`（一覧に存在した課題のID）、任意の `endedSourceIds`（一覧にあったが終了した課題のID。省略は空） |
| `assignments` | 詳細を読めた課題。下表 |
| `failures` | `courseId`（全体ならnull）、`kind`（`not-logged-in`・`http`・`parse`）、`detail`（固定コード） |

`courseResults` は `catalogCourses` にある授業だけを指す。課題はその授業の `seenSourceIds` に存在しなければならない。`sourceId` は同じ接続先の中で一意で、授業IDを含めてもよい。重複した授業・課題IDは拒否する。詳細を読めなかった課題は一覧のIDを残し、`assignments` に入れない。

Issue #105（[D28](decisions.md#d28-今の学期と終了していない課題に取得を絞る2026-11-07issue-105)）：`currentTerm: false` の授業は開かず、その授業の `courseResults`・`assignments` は送らない。`endedSourceIds` は同じ授業の `seenSourceIds` の部分集合で、重複と `assignments` との重なりを拒否する。上限は1授業1,000件。終了だけの授業も、一覧を最後まで確認できれば `listComplete: true` にする。

YNUの学期は取得時刻の日本時間で4〜9月を春学期、10〜3月を秋学期とする。CoursePower定義の任意の `courses.term` で表示を読み、「通年」・不明・未知の表示は対象に残す。同じ授業の複数カードに異なる表示があれば、対象になるカードが1つでもあるときは取得する。ホームの既存の `readPage` の出力と見本の正解は変えず、`readCourseTerms` で追加の表示を読む。

YNUでは一覧の「公開終了」は詳細を開かず終了とする。詳細の締切が取得時刻より前、または提出期間が文字どおり「-」の場合も終了IDだけを送り、新しい課題として保存しない。締切と取得時刻が等しい場合は終了にしない。「-」以外の読めない締切や、公開終了でない課題の詳細失敗は、従来の要確認・失敗の扱いを維持する。

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
| `presenceState` | `active`、`cancellation-candidate`、`cancelled`、`ended`（終了） |
| `consecutiveMissingCount` | 完全な一覧で連続して不在だった回数（0〜2、2で上限） |
| `lastSeenObservationId`、`lastSeenAt` | 一覧で最後に存在を確かめた根拠。詳細の失敗時も更新する |
| `reviewReasons` | 締切が読めない、文章と食い違うなど。読めない回に公式の締切を消さない |
| `preparationStartsAt` | 自動で出す準備の目安。今回はnull。確定した準備の予定とは別 |

変更履歴は `changeId`、`assignmentKey`、`kind`、`before`、`after`、`observationId`、サーバー時刻の `recordedAt`。種類は新規、題名の変更、締切の変更、提出、取消の候補、取消、再出現（`restored`）、終了（`ended`）。日時の表記だけが変わって同じ時刻を指す場合は、締切の変更に数えない。

取消の回数は `listComplete: true` で不在のときだけ進める。不完全な一覧は回数を進めず、一覧に再びあれば0に戻す。詳細の失敗は不在とみなさない。候補・取消から再出現したときはactiveに戻し、履歴を残す。提出状態は取消状態と独立して保持する。

終了IDは既存の課題だけを `ended` にする。今の学期でない授業の既存の課題は、保存済みの公式締切が `fetchedAt` より前、または公式締切がない・読めない場合だけ `ended` にする（Issue #107）。日時が等しい場合は残し、日付だけの締切はその `timeZone` で翌日になってから終了にする。未来の公式締切を持つ課題は学生の「締切の近い課題」にも残す。終了時は取消の回数を0に戻す。詳細・公式締切・提出状態は保持し、終了IDの存在を確かめたときだけ最終確認の根拠を更新する。後の一覧から消えても取消の候補にせず、詳細を読めた未終了の課題として再び届いたときだけactiveに戻し `restored` を記録する。終了した課題は学生の「終了した課題」に置き、次の締切・面談の締切と要確認・準備の候補から外す。`currentTerm: false` の授業は学生・面談の時間割と空きコマの判定から外す。

取得状態は `studentId`、`system`、`lastAttemptedAt`、`lastSucceededAt`、`lastFailureKind`、`lastResult`（`success`・`partial`・`failed`）、`lastAppliedObservationId`。今の学期の全授業の一覧と、終了ID以外の課題の詳細を取得でき、失敗がない回だけ成功時刻を更新する。一部成功や失敗で以前の成功時刻を消さない。対象の授業や課題がすべて終了している場合も成功にできる。

APIは受領記録、授業、台帳、履歴、取得状態を1つのFirestoreトランザクションで保存する。再送では文書の更新時刻も変えない。カレンダーの同期対象も同じトランザクションで保存する（Issue #40）。GoogleカレンダーやGeminiの呼び出しは含めない。coreの `applyObservation` はI/Oなしで更新を計算し、既存の受領記録が渡されたときは適用を行わない。

## 準備の予定と既存の読み取り部品

`PreparationPlan` は下記のIssue #49の保存契約。自動の準備の目安・一時的な候補とは別に扱う。

HTML読み取り部品の中間結果 `ReadAssignment` は観測の送信形とは別。従来の `dueAt`・`dueText` を持ち、取得部品が根拠に応じて上の `deadline` に変換する。`dueAt: null` だけから締切なしとは判断しない。`stripSessionId` はpathの `;SID=...` を除く既存の補助で、queryなどを含む一般的な秘密除去ではない。

## 面談日時と担当する学生（Issue #21）

`SessionContext` は `lastSessionAt`・`nextSessionAt` の2項目。どちらもタイムゾーン付きISO 8601日時、未設定なら `null`。保存先は `students/{uid}/sessionContext/current`。APIは実在する日付・時刻・時差を検査し、両方の項目を必須にして、未知の項目を拒否する。未設定の期間を画面が推測することはない。

- `GET /api/v1/supporter/students`：Firebase ID tokenで認証した支援担当について、許可文書の `scopes` がリストで `all` を含み、`revokedAt` が明示的に `null` の学生だけを `{ students: [{ uid, displayName? }] }` で返す。`displayName` はサーバーが体験学生と確認できた場合だけ架空の名前を返し、過去のプロフィールに名前がなくても初期シナリオと同じ名前を返す（Issue #129）。通常利用者の表示名やメールは返さない。全学生の一覧をクライアントから問い合わせる規則は追加しない。
- `PUT /api/v1/students/{uid}/session-context`：本文は `SessionContext`、上限2 KiB。支援担当への許可の読み取りと日時の上書きを同じFirestoreトランザクションで行う。本人または有効な共有許可がある支援担当だけが保存できる（Issue #49）。それ以外は403。成功時は保存した2項目を200で返す。
- どちらも既存のID token検証（失効確認付き）を使い、応答に `Cache-Control: no-store` を付ける。未認証401、不正な本文400、サイズ超過413、JSON以外415、保存失敗500。エラーは固定コードのみ。実物の入力やSDKの例外を応答・ログに出さない。

画面は許可文書をサーバーから確認してから、授業・課題・変更・更新状態・面談日時を購読する。許可の取消・削除、購読失敗で内容を消し、購読を止める。学生切替・ログアウトでも前の学生の表示と購読を破棄し、遅れて届いた通知で復活させない。台帳の永続キャッシュは作らない。通信が切れている間の取消を即座に検知したり、すでに渡した情報を回収したりするものではない。

締切の表示期間は現在から次の面談日時まで（両端を含む）。日付だけの締切は、その締切の `timeZone` での今日から面談日までを含め、時刻を補わない。提出済み・取消済みはこの一覧から外す。前回からの変化は、前回の面談日時より後、現在までの変更を新しい順に出す。要確認は締切の表示期間と独立して扱う。確認画面では該当する課題の行に印と理由を添え、相談画面の「今日決めること」にも出す。3日以上更新がない接続先と、一部しか確認できなかった接続先には更新状況を添える。


## 面談の画面と準備の候補（Issue #39）

- `/session` は学生の選択、`/session/{uid}` は「確かめる」、`/session/{uid}/plan` は「相談する」。共有の案内は選択画面だけに出す。体験学生は担当学生APIの架空の名前を表示し、一覧・見出しに内部IDを出さない。通常利用者は従来どおりIDで表示する（Issue #129）。
- 2つの画面は同じ許可確認と購読を使う。既存の `plans` も読み、`decidedOn` が前回の面談日（日本時間）と一致する準備の予定だけを「前回の約束」に出す。空なら欄自体を出さない。今回の日時はその学生の画面を開いた時刻で、保存しない。
- `PreparationCandidate` は `assignment`・`date`・`period` だけ。確定した予定のID、カレンダーのID、承認状態は持たず、Firestoreにもブラウザの永続領域にも保存しない。
- 対象は、現在から次回の面談までに締切がある、提出済み・取消済み以外の課題。各課題につき2つまで、平日で授業がないコマを日付・時限順に挙げる。同じ空きコマを別の課題にも示すことがある。選ぶ対象の課題だけを時間割に重ねる。
- 時間割は日本時間。時限数は学生画面と同じく最低5限と授業の最大時限。時限の開始時刻がまだないため、過ぎたコマを勧めないよう翌日以降・締切の前日までに限定する。日付だけの締切にも時刻は補わない。授業以外の個人の予定が空いているとは判断しない。
- Issue #49で無効の「学生に確認を頼む」を「入れる」に置き換えた。候補を選び、開始・終了時刻を入力したときだけ、下記のAPIに送る。既に同じ課題・日付・時限で保存した候補は重ねて出さない。取消した予定は「前回の約束」からも外す。

候補と画面分割の経緯は [Issue #39の記録](records/2026-11-06-session-split.md)。現在の保存契約は次節。

## 準備予定の保存と取消（Issue #49）

[案Aの決定](decisions.md#d25-学生と支援担当が準備の予定を入れ学生が外せるようにする2026-11-06issue-49)に従う。型は `PreparationPlanInput` と `PreparationPlan`。保存先は `students/{uid}/plans/{planId}`。既存のFirestore規則で本人・共有中の支援担当が読み取り、クライアントの直接書き込みは拒否する。

- `PUT /api/v1/students/{uid}/plans/{planId}`：`planId` はクライアントが操作ごとに作る小文字UUID v4。同じ内容の再試行では同じIDを送る。本文は `{ assignment: { system, sourceId }, date, period, startsAt, endsAt }` だけ。日付は実在する `YYYY-MM-DD`、時限は1〜24の整数、時刻は同じ日付の `YYYY-MM-DDTHH:mm:00+09:00` で開始より終了が後。この保存APIは時限から時刻を補わず、時刻は利用者が入力する。
- Firebase ID tokenの本人か、`scopes` がリストで `all` を含み `revokedAt: null` の支援担当のみ保存できる。共有許可・体験用プロフィールの確認と保存を同じトランザクションで行う。体験用学生は本人にひも付く学生プロフィールを必要とし、課題の接続先は `demo-lms` だけ。体験用の操作を別の組・実物の学生へ流さない。
- 新しい予定は、その学生の台帳にある提出済み・取消済み以外の課題を必要とする。開始は未来で、課題の締切より後でないこと、指定曜日・時限に授業が入っていないことをサーバーが検査する。日時の締切と開始が等しい場合は保存でき、日付だけならその `timeZone` の当日末までを含む。締切なし・読めない・未設定の場合は締切の検査を加えない。締切後は409の固定コード `plan-after-deadline` で断り、予定・同期対象を保存しない（Issue #129）。個人のカレンダーや他の準備予定の重なりは判定しない。時限と入力時刻の対応も検査しない。自動の後回しで使う時刻設定は「今日やることと準備の記録」の節を参照。
- APIは入力に加え `planId`・課題の `title`・`decidedOn`（保存日の日本時間）・`timeZone: 'Asia/Tokyo'`・`confirmedBy`（認証済みUID）・`createdByRole: 'student' | 'supporter'`・`confirmedAt`（サーバー時刻）・`status: 'active'`・`revision: 1`・`calendarItemKey` を保存する。登録者や同期先を本文で指定することはできない。
- 同じ登録者・ID・内容の再送は保存済みの予定を返し、版や時刻を進めない。同じIDで内容や登録者が違う場合、または取消済みの場合は409。取消済みの予定を再度入れるには新しいIDを使う。予定の日時変更は、外して別の予定として入れる。
- `DELETE` は同じURLで本文なし。学生はどの予定も、共有中の支援担当は自分が入れた予定だけを外せる。`status: 'cancelled'` にし `revision` を1つ増やす。記録を消さず遅れたPUTでの復活を防ぐ。同じDELETEの再送では版を進めない。
- 予定と `calendarItems/{calendarItemKey}` を同時に保存する。キーは `['preparation', planId]` のJSONのSHA-256、`kind: 'preparation'`、`sourceKey` は課題キー。開始・終了・題名・登録者の区分を保存時に固定し、LMSの締切変更で動かさない。取消は `desired: { state: 'deleted' }` とし、既存の版・世代・予定IDによる結果報告を使う。
- 保存後、サーバーのプロフィールに従って既存の体験用同期を呼ぶ。実物の学生には模擬同期せず、#40のAPIを通じて拡張機能が処理する。体験用の書き込み失敗時も予定と同期待ちは残り、同じ操作の再試行か次の「LMSを開く」で再試行する。画面表示だけを同期成功としない。
- 成功は200で保存した `PreparationPlan`。未認証401、不正な入力400、許可なし403、競合・対象課題なし・授業のあるコマ・過去の時刻409、4 KiB超413、PUTのJSON以外415、保存または模擬同期失敗500。応答は `Cache-Control: no-store`、エラーは固定コードのみで入力や例外を返さない。

締切が前倒しされ既存の準備の開始が締切より後になっても消さず、学生・面談画面の一覧と予定の詳細・マスに「締切より後の予定です」を表示する。面談の時間割は選択課題の締切を日の列に時刻付きで示し、締切のある週と土日の列にも移れる（日付のみなら時刻を補わない。Issue #129）。

学生画面も `plans` を購読する。学生・面談画面の時間割の該当コマは課題名と、支援担当が入れた場合だけその印を表示し、押すと日付・時刻・登録者を開く。予定一覧には日付・時刻・時限・課題名・登録者と、許可された取消ボタンを1件1行で表示する。学生変更・ログアウト・購読失敗で前の表示を消す。実物の同期は拡張機能の起動・観測送信後などの既存のきっかけを使い、定期同期は追加していない。

## お知らせの受信と要確認（Issue #45）

`POST /api/v1/announcements` は観測と別のAPI。Firebase ID tokenで本人を決め、本文は `{ system, courseId, announcement: { announcementId, version, publishedAt, body } }`。`publishedAt` は秒までのタイムゾーン付き日時。本文64 KiB、お知らせ12,000文字、ID200文字、版100文字まで。未知の項目とSID・Cookie等の認証情報を含む文字列を拒否する。任意の文章に埋まる未知の秘密を完全に識別するものではない。

実物の側は無効のまま。既定では503で、`ENABLE_DEMO_ANNOUNCEMENTS=true` とプロジェクトIDの設定がある場合だけ模擬側を有効にする。さらにサーバーの `demoAccounts/{uid}` が `role: 'student', studentId: uid` であることと、`system: 'demo-lms'` を確認する。実際のLMS・未登録の利用者・体験用の支援担当は403。画面からの送信はIssue #84で体験用LMSに接続した。公開先での確認は [PR #128の再確認記録](records/2026-11-07-issue-123-review.md#公開先の操作) を参照。

候補は本人の同じ接続先・授業の、取消済みでない課題だけ。候補キー・引用・日時を検査した提案だけを反映する。反映直前の台帳をトランザクションで読み直し、`reviewReasons` に `conflicting-deadline` を追加する。`detail` はお知らせID・版・提案日時だけで、引用・お知らせ本文・生のモデル応答は保存しない。公式締切・根拠・提出状態・課題の観測・変更履歴は変えない。提案が現在の公式日時と同じ瞬間なら追加しない。後続の観測でも要確認は残す（解消の操作は対象外）。

同じ本人・接続先・授業・お知らせID・版の組をSHA-256にして、サーバー専用の `students/{uid}/announcementReceipts/{hash}` に処理権を先に保存する。Geminiはトランザクションの外で呼ぶ。同時再送・サーバー再起動後も同じ版を二度処理せず、失敗後や途中停止後も自動で再試行しない。途中停止は `status: 'processing'` のまま残り、管理上の回復は後続の課題。完了時は固定の `status` と `changed` だけを保存する。

200の応答も `{ status, changed }` だけ。statusは `proposal`・`abstained`・`invalid-output`・`invalid-input`・`model-error`・`duplicate`・`budget-limit`。候補なし・50件超など解析の上限外は `invalid-input` でGeminiを呼ばない。未認証401、受信書式不正400、サイズ超過413、JSON以外415、保存失敗500。すべて `Cache-Control: no-store`、エラーは固定コードのみ。モデル失敗・待機は別リクエストの観測処理を止めない。

APIのGemini費用はサーバー専用の `announcementUsage/{日本時間の日付}` で全インスタンス共通に予約・精算する。初回M3測定19,410トークンの3倍以内、呼び出し1回・再試行なし。既存の入力16,000バイト相当と出力4,096トークンの上限も適用する。1日推定3,000円を超える予約を拒否し、失敗・usage不明では予約を残す。単価と換算は `announcements/budget.ts`。ローカルM3評価の別予算や他のAPI利用を合算した実請求額ではないため、それらを並行して回す運用にはしない。

検証は `pnpm test:announcements:emulator`（Auth・Firestore、架空データと代替モデルだけ）。実物のGeminiへの新たな送信・保持条件の確認・デプロイはこの検証に含まない。模擬LMS画面を通す試験は `pnpm test:demo-announcements:emulator`（Playwrightの指定は [demo.md](demo.md)）。

## 締切のカレンダー同期（Issue #40）

型は `CalendarItem`・`CalendarIntegration`・`CalendarReport`（`types.ts`）、予定の組み立てと版の判定は [`calendar.ts`](../packages/core/src/calendar.ts)。Issue #49で準備予定にも同じ版・世代・結果報告を使用する。締切は台帳から、準備予定は保存・取消APIから同期対象を作る。

- `students/{uid}/calendarItems/{assignmentDocumentKey}` に、`kind: 'deadline'`（準備は `'preparation'`）、`sourceKey`、`calendarId`（未接続はnull）、`eventId`、`generation`、`desiredRevision`、`desired`、`appliedRevision`、`appliedAt`、`lastAttemptedAt`、`lastErrorCode` を保存する。`desired` は `{ state: 'present', event }` または `{ state: 'deleted' }`。版と世代は1から、反映済みの版は0から。予定IDは作成前に決めたUUIDのハイフンを除いた文字列。
- 観測から作る同期対象は台帳と同じトランザクションで更新する。予定の中身が同じなら版を進めない。観測の再送では同期対象も書き換えない。Googleへの通信はトランザクションの外で行う。
- `students/{uid}/integrations/calendar` は `mode: 'google' | 'mock'`、`executor: 'extension' | 'demo'`、`calendarId`、`connectionState: 'connected' | 'reauthorization-required' | 'recovery-required'`。未接続は文書の不在で表す。今回のAPIで登録できるのは既存のGoogle専用カレンダーのみ。模擬側は下記のサーバー内処理が管理する。
- `GET /api/v1/calendar-sync` は `{ integration: CalendarIntegration | null, items: CalendarItem[] }`。本人のうち、接続先があり、望ましい版と反映済みの版が異なる対象を返す。削除確認後の再出現と、他の台帳更新経路からの変更も、現在の台帳と照合してから返す。
- `POST /api/v1/calendar-sync` の接続時の本文は `{ calendarId }`。拡張機能の接続テストで作成・保存した専用カレンダーを登録する。`primary` は拒否し、既存の接続先と異なるID・模擬モードへの上書きは409で停止する。接続先を切り替える復旧操作は未実装。
- 同じPOSTの結果報告は `{ itemKey, generation, eventId, revision, errorCode }`。成功の `errorCode` はnull、失敗は `authorization-required`・`calendar-unavailable`・`event-conflict`・`network-error` のいずれか。保存中のキー・世代・予定ID・望ましい版がすべて一致したときだけ記録する。古い版と、既に反映済みの版への報告は何もしない。成功時刻はサーバーで付ける。
- 削除の予定は成功報告まで残す。削除確認より先に課題が戻っても、まず古い予定を削除し、次の取得で世代と予定IDを変えて作り直す。作成・更新・削除の応答が失われたら、同じ予定IDの取得から再試行する。所有の印が違う予定は書き換えない。

両APIともFirebase ID tokenの本人だけを扱い、支援担当の権限では他の学生の同期文書を操作できない。POSTは4 KiB以下、未知の項目と不正なキーを拒否する。エラーは401・400・413・415・409・500の固定コードのみ。応答は `Cache-Control: no-store`。Googleのaccess tokenはAPIに送らない。

予定名は授業名と課題名、要確認なら先頭に「【要確認】」。説明は締切の原文、LMSのリンク、食い違う日付だけ（`conflicting-deadline.detail` の既存のお知らせ抽出形式から日付を拾い、引用本文は転記しない）。HTMLとして解釈される文字は表示を保つためにescapeする。時刻ありは5分の目印とその説明、日付だけは終日、提出済みは通知を外し、取消・終了は削除する（実物・体験用とも同じ）。締切が読めなければ以前の公式の締切を残す。

拡張機能の `config.local.json` に `apiOrigin`（HTTPSのoriginだけ）を設定すると、その接続先だけをビルド時のhost permissionとCSPへ追加する。空なら接続テストだけが動く。worker起動時・Chrome起動時・接続テスト成功後・`sendObservation` の送信成功後に同期する。同じworker内の同期は直列に実行する。Googleの認可は `interactive: false`、Firebaseと同じuidかも確認してから予定を書く。1学生1Chromeプロファイルが前提。実LMSの取得では `collection-worker.ts` が観測を送り、受領成功後に `syncCalendarInBackground()` を直接呼ぶ。カレンダー専用の定期同期はない。接続状態は拡張の設定画面で確認する。

設定画面からの内部メッセージ `calendar-sync` と `observation-send` でも同期を試せる。他の拡張機能・LMSのページ・子フレームからの要求は拒否する。`observation-send` の応答は観測の受領結果であり、カレンダー同期の成功とは区別する。同期に失敗しても受領済みの観測を失敗に戻さず、サーバーの同期待ちを次回に処理する。


## 体験用カレンダー（Issue #47）

Issue #47の本文・コメントと設計案5・7節の承認範囲で実装。既存のHTTP入力・応答とFirestore規則は変えない。`GET/POST /api/v1/calendar-sync`は引き続き体験UIDを拒否する。

- 体験学生の観測を受領した後、サーバーが`demoAccounts/{uid}`の学生本人をトランザクションで確認し、`integrations/calendar`を`mode: 'mock', executor: 'demo', calendarId: 'demo-calendar'`で用意する。既存の実物の接続は上書きしない。通常の利用者はこの処理の対象外。
- 同文書の任意項目`mockEvents`が模擬の書き込み先。キーは予定ID、値は`{ itemKey, generation, revision, event: DeadlineEvent }`。`calendarItems.desired`とは別の保存済み予定であり、画面が望ましい状態から予定を合成することはない。学生本人だけが既存の規則で読める。
- 共通の`reconcileCalendarItem`で望ましい予定を計算し、`acknowledgeCalendarItem`で版・世代・予定IDを確認する。締切と準備の同期対象について、模擬予定の作成・移動・削除と成功の記録は同じトランザクションで確定する。取消後の再出現は古い削除を確認してから新しい世代にするため、最大2巡する。Googleへの通信は発生しない。
- 同期失敗では成功の版を進めず、HTTPは既存の固定エラーを返す。台帳と観測の受領記録は既に保存されている場合がある。同じ観測を再送すると台帳を重複更新せず模擬同期を再試行する。サーバー停止後も、次の「LMSを開く」で再試行できる。定期の再試行はない。
- 学生画面は保存済み`mockEvents`と版の差を読み、「体験用カレンダー」と更新待ちを表示する。ログアウト・本人変更・購読失敗で前の表示を消す。支援担当はこの文書を読めず、従来の共有された台帳を面談画面で読む。

少量の架空の体験データ用であり、模擬予定は1文書に収まる範囲。実物のカレンダー同期、大量データ、デプロイ先での成功はこのローカル試験結果に含めない。準備の予定はIssue #49の試験で確認する。

## 手で入れた課題（Issue #98）

型の正本は `ManualAssignmentInput`・`ManualAssignment`（`types.ts`）。LMSの観測・台帳とは別の `students/{uid}/manualAssignments/{manualAssignmentId}` に保存する。LMSの取得はこのコレクションを変更しない。[D31](decisions.md#d31-lmsに出ない課題を学生と支援担当が手で入れる2026-11-07issue-98)のSoraの承認範囲で実装。合意方法はD29に従う。

- `PUT /api/v1/students/{uid}/manual-assignments/{id}` の本文は `{ title, date, time, course, memo }` のみ。IDはクライアントが操作ごとに作る小文字UUID v4。同じ内容の再試行は同じIDを使う。
- `title` は空白だけを除く1〜160文字、`memo` は0〜300文字。両方とも制御文字は不可。`date` は実在する `YYYY-MM-DD`、`time` は日本時間の `HH:mm` またはnull。時刻がnullなら日付だけの締切として扱い、23:59などを補わない。過去の課題も登録できる。
- `course` は `{ system, courseId }` またはnull。選んだ授業はその学生の `courses` にあることを保存時に確かめ、表示用の `courseName` をサーバーで保存する。授業を選ばなくても保存できる。体験用は `demo-lms` の授業だけ。
- 保存文書は入力に加えて、`manualAssignmentId`、`courseName`、`createdBy`、`createdByRole`（student/supporter）、サーバー時刻の `createdAt`、`status`（active/cancelled）、`revision`、`calendarItemKey` を持つ。登録者は認証から決め、本文での指定は拒否する。
- Firebase ID tokenの本人、または `scopes` がリストで `all` を含み `revokedAt: null` の支援担当が追加できる。共有と体験プロフィールの確認・保存は同じトランザクション。体験用アカウントは自分の組以外を操作できない。
- `DELETE` は本文なし。学生本人は登録者を問わず消せる。支援担当は共有中で、かつ自分が登録したものだけ消せる。取消の文書を残して版を1つ進め、同じ削除の再送は版を進めない。取消後の遅れたPUTは409で拒否する。編集は今回の範囲外で、入れ直すときは新IDを使う。
- 同じID・登録者・内容の再送は保存文書を変更せず、カレンダーの再試行だけ進める。同じIDの別内容・別登録者は409。成功は200と保存文書。認証401、権限403、書式400、4 KiB超413、JSON以外415、保存・同期失敗500。未設定のAPIは503。エラーは固定コードだけ、成功も `Cache-Control: no-store`。
- 本人と共有中の支援担当だけがFirestoreを読める。全員の直接書き込み・入れ子の読み取りは拒否する。共有取消・購読失敗・ログアウト・本人変更時は画面の内容と操作を消す。
- 同期対象は手入力文書と同じトランザクションで保存。`kind: 'manual-deadline'`、`sourceKey: { system: 'manual', sourceId: id }` とし、既存の版・世代・予定ID・結果報告を使う。日付のみは終日、時刻ありは5分の目印。説明には手入力の登録者区分と締切を出し、メモや架空のLMSリンクは入れない。
- 体験用は既存の保存済み模擬予定へ同期。実物は既存の拡張機能に渡し、未接続ならキューに残す。実際のGoogleカレンダーへの書き込みはローカル試験に含めない。
- 既存の「体験を最初からやり直す」は本人のactive/cancelled両方の手入力文書と同期対象・模擬予定を消す。`onlyIfStale: true` で日付が新しい間は課題を残す。他の組は消さない。

## 今日やることと準備の記録（Issue #112）

- `GET /api/v1/digest`：失効確認付きFirebase ID tokenの本人だけを読む。応答は `{ date, to, subject, text, html, empty, plans, assignments }`。`date` は日本時間の今日、`to` は検証済みtokenのメールだけ。メールが無ければ403。queryの学生ID・宛先は使わず、体験用の支援担当は403。送信は拡張の `digest-browser.ts` がGmail APIで行う（Issue #113）。
- `plans[]` は今日の `active` な準備の予定で、課題が提出済み・取消済み・終了済みのものは除く。各項目は `{ planId, date, period, startsAt, endsAt, title, courseName, deadline, url, status, doneUrl, laterUrl, subject, text, html }`。項目内の件名と本文はその予定1つ分のメール。件名は「13:00から：課題名の準備」の形で、朝のまとめの件名と分ける。`assignments[]` は48時間以内の未提出・取消/終了以外の課題で `{ title, courseName, deadline, url }`。準備を `done` にしても、LMSで未提出なら締切のまとめには残す。LMSの提出状態は変えない。
- `deadline` は原文を外した `{ kind: 'datetime', dueAt, timeZone }` / `{ kind: 'date', date, timeZone }` / `{ kind: 'none' | 'unreadable', timeZone }` / `null`。日時は現在と48時間後の両端を含み、日付だけの場合はそのタイムゾーンの両端の日付を含む。時刻を補わない。課題本文・解説・お知らせ本文・締切の原文は本文にもJSONにも複写しない。課題名と授業名の連続する空白・改行は空白1つにまとめる。HTMLは文字とリンクをescapeする。`packages/core/src/mail-safety.ts` の `isSafeMailText` とURL検査で危険な値を含む課題だけを除き、ほかの課題は返す。同関数はHTMLの文字参照と連続するパーセント符号を最大5巡で復号・検査し、収束しなければ拒否する。拡張も同関数を使い、送信直前には現在の認証値を任意の第2引数に渡して、復号した文字列との一致も拒否する。認証値はサーバーには渡さない。送信対象が無ければ `empty: true`。
- `doneUrl` / `laterUrl` は `<公開先>/student/plan?id=<予定ID>&do=done|later&rev=<revision>`。秘密の値は含まない。公開先はサーバー設定 `PUBLIC_WEB_ORIGIN`（末尾の `/` は除く）。未設定でもAPI全体は起動し、`GET /api/v1/digest` だけ503を返す。準備の操作と体験見本の作成は公開先を必要としないため使える。HTTPSのoriginだけを認め、エミュレーターだけ `http://127.0.0.1:<port>` も使える。要求のHostからは作らない。Webページを開き、未ログインならログインしてから、認証した本人の予定だけをPOSTで操作する。GET APIで書き込まない。
- `POST /api/v1/plans/{planId}/done|later?rev=<revision>`：本文なし、IDは既存の小文字UUID v4。保存先の学生はtokenのUIDだけで決め、共有中でも支援担当は学生の代わりに押せない。予定の `status` に `done` を追加。任意の `changedBy`・`changedAt` は認証済みUIDとサーバー時刻。古い予定は項目なしのまま「まだ」と読む。移動後は `laterResult: 'moved'` を任意で保存する（旧 `no-slot` も読み取れる）。正の安全な整数の版番号 `rev` が今の予定と一致するときだけ変更する。成功時は `students/{uid}/planActionReceipts/{planId}-{revision}-{action}` に応答を保存し、同じ版・同じ操作の再送・同時操作には変更せず `outcome: unchanged` と現在の予定を返す（Issue #129）。その版が別の操作で使われていたら409。記録のない古い版・未来の版も409。409の `plan-conflict` には認証した本人の現在の `plan` を添え、画面は変更していないことと現在の状態・日時を伝える。現在の予定を添えられない競合では「予定が変わりました。学生の画面で確かめてください。」と出す（Issue #129）。記録はクライアントには読み書きさせない。
- 応答は `{ outcome: 'done' | 'moved' | 'no-slot' | 'unchanged', plan: PreparationPlan, demo: boolean }`。doneは準備の記録だけで、課題の提出状態は書き換えない。完了した準備のカレンダー予定は削除対象にする。laterは既存の候補と同じ、翌日以降・平日・締切の前日までのコマを順に調べ、元の予定より後で、今の学期の授業も他の有効な準備予定もない最初のコマへ移す。有効な準備との重なりは、保存された時限の番号ではなく、設定表の開始・終了と予定の開始・終了の時刻で判定する。接するだけの時刻は重なりに含めない。元の準備の長さを保ち、移動先の開始も締切の検査を通す。確認できる空きがなければ元の日時・版を保ち、操作の記録を保存せず毎回計算し直す。学生画面の後回しボタンは予定が未来で有効な限り表示し、新しい版から繰り返し動かせる。
- 自動移動の時刻設定は共通核の `preparationPeriodTimes: Partial<Record<LmsSystem, PreparationPeriodTimes>>` で管理し、現在はYNUと架空の体験用だけ。YNUの公表時刻を使う（[D30](decisions.md#d30-今日やることと準備の完了後回し2026-11-07issue-112)）。未設定のPandAや、準備が1コマに収まらない場合は推測して動かさない。個人のカレンダーが空いているかは判断しない。
- 状態・操作者・時刻・移動先・既存カレンダーの同期対象を同じトランザクションで保存する。done・laterの再送で版や時刻を進めない。体験用は保存後に模擬予定へ同期し、失敗時は同じ要求で再試行する。実物は既存の拡張機能による同期のきっかけを待つ。画面には実物の更新完了とは表示しない。応答の `demo` は同じトランザクションで確認したサーバーのプロフィールから決める。画面は課題の接続先から推測せず、体験用の移動成功には「体験用の予定を更新しました」と表示し、拡張機能の案内を出さない（Issue #129）。学生と許可済み支援担当が `plans` を購読し、完了した予定も一覧に残す。クライアントからの書き込みは引き続き全拒否。
- `POST /api/v1/digest/demo-plan`：本文なし、体験学生本人だけ。先に「LMSを開く」で台帳へ入れた架空課題に、今日のメールを試す見本を用意する。今日の日付の有効な（`active`）見本があれば、そのまま返す。なければ（後回しで別の日へ動いた・終わった・外した・前の日のもの）、新しいID・版1で今日の見本を作る。前の予定・カレンダーの同期対象・操作の受領記録を、新しい見本の内容で上書きしない。画面に現在の日時と状態を示し、最初から試すときは「体験を最初からやり直す」を案内する（Issue #129）。授業と別の有効な準備の時間を避ける。過去の開始時刻も含む朝の見本で、実物アカウントや実物カレンダーには使えない。`/demo-lms` は専用のGET demo-previewのHTMLをそのまま描き、ボタンは同じ本人限定APIを呼ぶ。「体験を最初からやり直す」は `plans` と `planActionReceipts` も消し、操作の記録を戻す。
- 未認証401、不正なID・本文あり400、本人の予定でない／体験条件を満たさない403、完了・取消後の別操作や対象課題の取消・提出409、内部の失敗500。エラーは固定コード、応答は `Cache-Control: no-store`。このAPIではメールの送信・定期実行を行わない。拡張の送信処理は次節を参照。

## 今日やることのメール送信（Issue #113）

- 拡張の `digest-browser.ts` が、設定で本人が有効にした場合だけ `gmail.send` の許可を求め、Gmail APIの `users/me/messages/send` で認証済み本人宛てに送る。Googleの送信用トークンをサーバーに送らず、メールの読み取りもしない。設定はFirebase UIDと接続設定にひも付け、別の本人には引き継がない。
- 日本時間の7:30以降に朝のまとめを1回、今日の有効な準備の開始30分前から開始前までにその準備1件のメールを送る。Chromeの起動・拡張の実行・有効な認可が前提。予定の再取得は通常15分間隔で、送信対象の時刻にも本文を取得する。対象が空なら送らない。
- 送信前に当日の送信記録を `chrome.storage.local` へ置く。応答が失われた場合も同じメールを自動再送せず、設定画面でGmailの確認を促す。メール本文は保存しない。朝のまとめ・準備ごとの送信と、無効化・本人変更・認可・本文の安全検査は `packages/extension/tests/digest-browser.test.mjs` で検証する。実際のGmailへの配信はこの試験の対象外。

## クラウド通知の共通部分（Issue #156、送り方と切替は未接続）

#153 のN1〜N4を具体化した契約。型は `NotificationSettings`・`NotificationStatus`・`NotificationTarget`・`NotificationDelivery`。契約と規則のmergeにはorangeの確認が必要。既存の拡張送信・GET digest・準備操作はこのPRでは変更しない。

| 保存先 | 内容と権限 |
|---|---|
| `students/{uid}/notificationSettings/current` | `enabled`、`deliveryOwner: none/extension/cloud`、正の整数`version`、`timeZone: Asia/Tokyo`、`morningTime: 07:30`、`recipientUid`、`migrationState: not-started/ready`、`updatedAt`。本人だけread。全client write deny。設定APIと移行手順は後続Issue。 |
| `students/{uid}/notificationStatus/current` | `state`、`settingsVersion`、`updatedAt`、`lastAcceptedAt`、`errorCode`。本人だけread、server write。API受理は受信トレイへの到着確認ではない。支援担当の共有対象に含めない。 |
| `students/{uid}/notificationDeliveries/{key}` | 対象・時間窓・予定の版・設定の版・状態・attempt・予約/開始/応答時刻。全client read/write deny。宛先・本文・認証情報・秘密の参照は保存しない。 |

設定欠損・OFF・cloud以外・本人UID不一致・移行未完了・体験アカウントは対象外。宛先はFirebase Authで無効でなく確認済みの本人から取得する口を用意し、リクエストから宛先を受け取らない。実senderと通知設定を更新するAPIは未接続。

`POST /api/internal/notifications/tick` は本文/queryなし。`NOTIFICATION_OIDC_AUDIENCE` と `NOTIFICATION_SCHEDULER_SERVICE_ACCOUNT` で指定した、GoogleのRS256署名・issuer・aud・有効期限・確認済みサービスアカウントを検証する。Firebase利用者tokenとSchedulerを名乗るheaderは使わない。既存APIのFirebase認証は維持する。許可したサービスアカウントのtokenを発行できる権限自体はCloud IAMで制限する必要があり、本PRで実設定は検証しない。

`PUBLIC_WEB_ORIGIN` と上のOIDC設定がないと入口は503。既定はdry-run。実送信は `NOTIFICATION_SEND_ENABLED=true` に加えてsenderの接続が必要で、このPRには実senderがないため設定だけでは送らない。dry-runは候補数だけを返し、送信台帳・本人状態を変更しない。処理終了を待って200と `{ dryRun, candidates, attempted }` を返す。未認証401、不正本文/query400、未設定503、処理失敗500。応答はno-store、失敗は固定コードのみ。

- 朝は日本時間07:30以上08:00未満、準備前は開始30分前以上・開始未満。翌日00時台の予定も前日中に選ぶ。朝のキーはUID・日本日付・morning、準備前はUID・planId・正規化した開始日時・reminderのJSONのSHA-256。設定/予定の版をキーに足さず、同じ日時に戻してもaccepted/unknownは再送しない。
- `pending → reserved → sending → accepted/failed/unknown`。予約と送信開始と結果保存を別のtransactionにし、外部senderはtransactionの外だけで呼ぶ。予約のleaseは2分、attemptを照合して回収し、古いattemptは開始/結果保存できない。送信開始時に最新設定・版・体験プロフィール・課題・予定を同じtransactionで読み直し、不要はskipped、時間外はexpired。停止が先に確定した場合は開始しない。開始が先なら、その1通は停止後にも受理される可能性がある。
- sendingのlease切れ、応答喪失、受理後の保存失敗はunknown。保存自体が失敗した場合はsendingを残し、後のtickでunknownにする。OFFになった利用者も回収対象。sending/unknownをpendingへ戻さない。failedは確実な未受理だけで、今回はfailed/skippedも自動再試行しない。未送信になる可能性を残す保守的な扱いで、exactly-onceを保証しない。
- 送信直前の提出・取消・終了・準備完了・移動・通知停止を反映する。締切の瞬間は含み、直後は除く。日付のみは元のtimezoneの当日を含み、時刻を補わない。完了した準備の未提出課題は既存の「次は提出」を使う。メールには接続先ごとの最終成功時刻・一部取得/失敗・72時間以上/取得歴なし・PC停止中のLMS変更は未反映という案内を付ける。既存Webの鮮度表示は変更しない。
- 設定はcollection groupをフィルターなしで最大51件読み、50件超なら固定エラーで停止する。厳密な文書パスを検証し、親のstudent文書の存在を前提にしない。新しい複合indexは不要。本人ごとの読取上限は予定200・課題200・授業100・取得状態3、回収対象200。超過時は切り詰めて送らず停止する。実Cloudのquery・IAM・費用・自然時刻の受信確認は後続Issue。

## 拡張送信の切替確認（Issue #163）

- `GET /api/v1/digest/delivery`：失効確認付きFirebase認証の本人だけについて `{ enabled: boolean, deliveryOwner: none/extension/cloud }` を返す。UID・宛先を入力から選べない。設定欠損は `{ enabled: false, deliveryOwner: none }`。不正な設定・体験学生は503（`unavailable`）で確認不可とし、体験支援担当は403。本文や送信記録は返さず、設定や記録を書き換えない。#162の設定保存APIとは別の読み取り専用経路。
- 拡張は各Gmail POST前にこのGETを確認する。`cloud`・確認失敗・不正な応答なら送らない。記録なし・`none`・`extension` はサーバーの `enabled` にかかわらず、拡張の本人の同意に従う。確認後も本人・ローカルの同意・日付・準備の期限を再確認してから既存の予約とPOSTへ進む。
- 旧 `GET /api/v1/digest` は、同じtransactionで通知設定を読み、`deliveryOwner: cloud` ならenabledにかかわらず403で本文を返さない。その他の既存の読み取り条件は維持する。
- `GET /api/v1/digest/demo-preview` は、同じtransactionで本人に一致する体験学生プロフィールを必須とするメール見本。cloud設定でも表示できるが、実物の利用者・支援担当は403。`/demo-lms` はこの専用経路を使う。旧GETのqueryで見本の判定を切り替えられない。
- いずれもno-store、未認証401、依存未設定503、内部失敗500、固定エラーのみ。送信や切替は行わない。端末停止・当日記録の引継ぎ・戻し方は [デプロイ手順](deploy.md#拡張のメールからクラウド通知へ移すissue-163) を正本とする。
