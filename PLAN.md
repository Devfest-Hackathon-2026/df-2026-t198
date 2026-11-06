# 計画と進捗

<!-- progress:start -->
完成条件：全体 31/43（72%）、必須 29/39（74%）
<!-- progress:end -->

上の数字は `pnpm progress --write` で書き換える。手で直さない。CIは数字と一覧が食い違うと落ちる。

## 数え方

- 完成条件は下の一覧の `C` 番号。1つの条件は、試験か実際の操作で「満たした・満たしていない」を決められる形で書く。
- 満たしたら `[x]` にし、行末に証拠を書く（PRの番号、試験の名前、測った記録の場所）。一部だけできたものは `[ ]` のまま。
- `〔削れる〕` の付いた条件は、遅れたときに削る候補（[decisions.md](docs/decisions.md) D11の順）。必須の数には入れない。
- 条件を足す・分ける・消すときは、Soraかorangeのどちらか1人の明示の合意で決め（[D29](docs/decisions.md)）、もう1人にDiscordで知らせて、下の「条件の変更」に日付と理由を書く。分母が変わったことが後から分かるようにする。
- 担当は〈Sora〉〈orange〉。〈未定〉は着手する前にどちらか1人が決め、もう1人に知らせる。

## 報告の形

Discordで進み具合を知らせるときは、次の形にそろえる。

```text
完成条件 全体 12/36・必須 10/30
今回満たした条件：C03 YNUの課題の読み取り、C11 台帳への記録（PR #8）
指標：M1 見本を正しく読めた割合 92% → 100%
止まっていること：C15 カレンダーへの書き込み（Googleの同意画面の設定待ち。Soraの操作が要る）
```

Discordは人が読むので、C番号やM番号には何のことかを添える。決めたことは、Discordではなく Issue か [decisions.md](docs/decisions.md) に書く。

## 完成条件

### 取得：YNU（CoursePower）

- [x] C01 〈Sora〉 拡張機能がLMSのページからSIDを受け取り、`chrome.storage.session` にだけ置く。→ PR #1、`packages/extension/tests/service-worker.test.ts`
- [x] C02 〈Sora〉 ホームの画面から、授業の一覧と曜日・時限を読み取る。確かめ方：保存したページの見本で試験 → ホームの見本の授業・曜日・時限が正解と一致（`packages/core/tests/html-reader.test.mjs`、service worker相当の試験 `packages/extension/tests/html-reader-worker.test.mjs`）
- [x] C03 〈Sora〉 授業ごとの教材一覧（課題もここに並ぶ。全授業をまとめた課題の一覧はLMSに無い）と課題の詳細から、題名・締切・提出の状態を読み取る。確かめ方：見本で試験 → `packages/core/tests/html-reader.test.mjs`、`packages/extension/tests/html-reader-worker.test.mjs`、M1 30/30（100%）。保存見本で確認
- [ ] C04 〈Sora〉 LMSを開いたとき、裏（service worker）で全授業の課題を取りに行き、観測を1つ作る。開いている画面の操作を止めない。確かめ方：実際のLMSで操作 → Issue #105：今学期・終了課題の扱いを架空HTML、台帳、偽Google、Auth・Firestore、学生のブラウザ操作で確認（[記録](docs/records/2026-11-07-issue-105.md)）。実機のsuccessはmerge・更新後にSoraが確認するため未完了。 Issue #109：操作中にフォーム値が古くなる偽LMSでの再試行・失敗の分離・10分間隔・診断を試験済み（[記録](docs/records/2026-11-07-issue-109.md)）。実機確認待ちは継続。 Issue #118：#99の空一覧を統合し、200の読取失敗を局所化・通信失敗のみの経路切替を偽LMSで確認（[記録](docs/records/2026-11-07-issue-118.md)）。実機の合格確認はmerge後。
- [ ] C05 〈Sora〉 裏で取れないときは、開いているページの側で取りに行く。確かめ方：裏の取得を止めた状態で操作 → Issue #118：裏の通信を止めた偽LMSで、空一覧・読取失敗の局所化・操作中の再試行を確認（[記録](docs/records/2026-11-07-issue-118.md)）。実機のsuccess・pageSucceededはmerge後に確認
- [x] C06 〈Sora〉 ログインが切れていたら `not-logged-in` の失敗として送る。ログインを促す画面は出さない。確かめ方：試験 → `packages/core/tests/login-state.test.mjs`、`packages/extension/tests/html-reader-worker.test.mjs`（固定の失敗コード。ログイン前・認証エラーの保存見本で確認）
- [x] C07 〈Sora〉 YNUの読み取り方を `lms-definitions/` にデータとして置き、取得部品がそれを読んで動く。確かめ方：試験 → `lms-definitions/coursepower/definition.json` を読んで動く（`packages/core/tests/html-reader.test.mjs` の「reads selectors from data」ほか、`packages/core/tests/definition.test.ts`）。Issue #10で製品固有のパターンを引数付きに移行し、別製品の読み取り・不正な引数の拒否を `packages/core/tests/parameterized-patterns.test.mjs` で確認

### 取得：PandA（Sakai）

- [ ] C08 〈orange〉 PandAの課題の一覧を取り、同じ形の観測を作る（Issue #2）。〔削れる〕
- [ ] C09 〈orange〉 PandAの読み取り方を `lms-definitions/` に置く。〔削れる〕

### 観測の送信と台帳

- [x] C10 〈未定〉 観測をサーバーへ送る。送る中身にSIDやCookieが入っていないことを試験で確かめる → `packages/server/tests/observations.test.ts`（認証・SID/Cookie拒否）、`pnpm test:observations:emulator`（架空観測のAPI送信・保存）
- [x] C11 〈未定〉 観測から、新規・締切の変更・題名の変更・提出を台帳に記録する。確かめ方：試験 → `packages/core/tests/ledger.test.ts`、`packages/server/tests/observations.emulator.test.ts`（新規・題名/締切変更・提出）
- [x] C12 〈未定〉 一覧を最後まで取れた授業で2回続けて見当たらない課題を取消にする。1回だけなら取消の候補にとどめる。確かめ方：試験 → `packages/core/tests/ledger.test.ts`、`packages/server/tests/observations.emulator.test.ts`（完全な一覧2回、詳細失敗、再出現）
- [x] C13 〈未定〉 同じ観測を2回受け取っても台帳が変わらない。確かめ方：試験 → `packages/core/tests/ledger.test.ts`、`packages/server/tests/observations.emulator.test.ts`（再送と同時再送。文書・履歴・取消回数を維持）
- [x] C14 〈未定〉 サーバーをCloud Runに置き、台帳をFirestoreに書く。確かめ方：デプロイした先で観測を1つ送る → Issue #47、`demo-m6-live.browser.mjs`（公開先の認証済み観測・本人の受領記録・台帳の締切と観測IDを照合）。[再デプロイと保存の記録](docs/records/2026-11-06-issue-47-live.md)

### カレンダー

- [x] C15 〈未定〉 拡張機能から `chrome.identity` でGoogleカレンダーに締切の予定を作る。確かめ方：実際のカレンダー → 本人の実LMSから自動同期した初回9件を実Googleの予定ID・開始終了時刻と照合。再取得後も9件でID維持（[初回記録](docs/records/2026-11-06-real-lms-check.md)）。24時補正後は13件で一致、同期保留0件（[追加記録](docs/records/2026-11-07-lms-page-fallback-check.md)）
- [x] C16 〈未定〉 締切が変わったら予定を動かし、取消なら予定を消す。同じ課題の予定を二重に作らない。確かめ方：試験と実際のカレンダー → Issue #40の指定に従い偽APIで判定：`packages/extension/tests/calendar-sync.test.ts`（作成・移動・取消・応答喪失時の再試行）、`packages/server/tests/calendar.emulator.test.ts`（版・世代・本人の分離）。実物は `docs/records/2026-11-06-issue-40-manual-check.md` の手順で未確認、C15に残す。Issue #69：`packages/extension/tests/collection-flow.test.mjs`（LMSを開く→取得→台帳→偽Googleへの作成・同じ予定の移動、裏・ページ側の両経路）。実機の通しは `docs/records/2026-11-06-issue-69-real-flow.md` でSoraの確認待ち
- [x] C17 〈未定〉 確かめが要る課題は、予定名の頭に「【要確認】」を付け、両方の日付を説明欄に1行で書く。確かめ方：試験 → `packages/core/tests/calendar.test.ts`（公式締切の維持・要確認の題名・食い違う日付を1行・本文を転記しない）

### 学生の画面

- [x] C18 〈未定〉 時間割（曜日×時限）の各授業のマスに、その授業の次の締切を出す（D13の案A）。確かめ方：画面 → `packages/web/src/student.test.tsx`、`packages/web/tests/student.browser.mjs`（Auth・FirestoreエミュレーターとChromiumで授業の2コマ・締切順・週末・6限を確認）。Issue #66：7日カレンダーの位置・札の翌日への移動・390pxを `packages/web/tests/demo.browser.mjs` で確認（[画面と記録](docs/records/2026-11-06-issue-66-verification.md)）。Issue #98：手で入れた課題も授業の次の締切に並ぶことを試験とブラウザで確認（[記録](docs/records/2026-11-07-issue-98.md)） main取り込み後の終了課題の除外と手入力の維持：[再検証記録](docs/records/2026-11-07-issue-98-main.md)。
- [x] C19 〈未定〉 マスを押すと、その授業の課題が横に開く。確かめ方：画面 → `packages/web/tests/student.browser.mjs`（授業欄の開閉・LMSリンク・要確認・提出・取消・390px幅を確認）。Issue #41：授業名・全曜日時限・SIDを含まない授業リンク、URLなしの非表示を `packages/web/tests/student.browser.mjs` で確認。Issue #98：授業の欄で手で入れた課題・登録者・メモ・削除を扱えることを試験とブラウザで確認（[記録](docs/records/2026-11-07-issue-98.md)）
- [x] C20 〈未定〉 裏の取得が終わると、開いたままの画面の内容が変わる（Firestoreのリアルタイムの更新）。確かめ方：画面を開いたまま取得 → `packages/web/tests/student.browser.mjs`（エミュレーターの架空台帳の締切・提出を変更し、マス・締切順・開いた課題欄の更新を確認。実LMSからの取得との通しは未確認）、`packages/web/src/student-data.test.ts`（本人変更・購読失敗時の表示消去）。Issue #66：開いたままの授業マス・課題欄・帯の札・面談の締切を2秒以内に強調し10秒後に解除する操作、3日以上前の情報の案内を同ブラウザ試験で確認（[記録](docs/records/2026-11-06-issue-66-verification.md)） Issue #124：文言を点検し、関連ブラウザ試験と1280/390幅で確認（[記録](docs/records/2026-11-07-issue-124.md)）。。Issue #98：手で入れた課題の追加・削除が開いたままの両画面に出ることを試験とブラウザで確認（[記録](docs/records/2026-11-07-issue-98.md)）
- [x] C21 〈未定〉 変化があったときだけ、LMSのページの隅に1行で知らせる。押すと学生の画面が開く。変化がなければ何も出さない。確かめ方：実際のLMS → 変化ありの通知とクリックで学生画面が開くこと、同じ内容の再取得で通知0件を確認（[実機記録](docs/records/2026-11-06-real-lms-check.md)）
- [x] C22 〈未定〉 拡張機能のポップアップは、学生の画面を開くボタンだけにする。確かめ方：画面 → Issue #44、`packages/extension/tests/change-notice.test.mjs`・`packages/extension/tests/probe-build.test.mjs`・`packages/extension/tests/change-notice.browser.mjs`（ボタン1つ・学生画面への遷移・同梱を確認）。[確認記録](docs/records/2026-11-06-issue-44-verification.md) Issue #124：文言を点検し、関連ブラウザ試験と1280/390幅で確認（[記録](docs/records/2026-11-07-issue-124.md)）。

### 面談画面

- [x] C23 〈未定〉 次の面談までの締切、前回の面談からの変化、要確認のものを出す。確かめ方：画面 → PR #36、`packages/web/tests/session.browser.mjs`（実ブラウザで学生選択・3欄・日時変更・即時更新・共有取消・学生画面とのログイン共有・ログアウト、390px幅）、`pnpm test:sessions:emulator`。記録と画面：`docs/records/2026-11-06-issue-21-verification.md`。Issue #67：上部の表示・学生IDの補助表示・締切変更の文章・開閉印とキーボード操作を `packages/web/tests/session.browser.mjs` と単体試験で確認。前後の画面：[確認記録](docs/records/2026-11-06-issue-67-verification.md)。Issue #94：取得から72時間の境界・一部成功/失敗の注意帯を単体試験と `packages/web/tests/session.browser.mjs`（1280幅・390幅、失敗後の更新）で確認（[記録](docs/records/2026-11-07-issue-94.md)） Issue #112：準備の完了・後回し・両画面の即時更新と保存済み体験用予定の移動を `packages/server/tests/digest.emulator.test.ts`・`packages/web/tests/digest.browser.mjs` で確認（[記録](docs/records/2026-11-07-issue-112.md)）。 PR #117の再確認：版ごとの再送と繰り返す後回し・時刻の重なりを試験（[レビュー対応](docs/records/2026-11-07-issue-112.md#pr-117のレビュー対応2026-11-07-6時台)）。 PR #117の再見直し：別操作の競合409・同一操作の再送と画面の案内を確認（[追加記録](docs/records/2026-11-07-issue-112-rereview.md)）。 Issue #124：文言を点検し、関連ブラウザ試験と1280/390幅で確認（[記録](docs/records/2026-11-07-issue-124.md)）。。Issue #98：手で入れた課題も次回面談までの締切に並ぶことを試験とブラウザで確認（[記録](docs/records/2026-11-07-issue-98.md)） main取り込み後の終了課題の除外と手入力の維持：[再検証記録](docs/records/2026-11-07-issue-98-main.md)。
- [x] C24 〈未定〉 時間割の空いたコマに準備の候補を出し、決めたものだけを準備の予定として保存する。確かめ方：試験と画面 → Issue #49、`packages/web/tests/plans.browser.mjs`（支援担当の「入れる」、学生の追加・双方の予定の取消、登録者の表示）、`packages/server/tests/plans.emulator.test.ts`（権限・再送・保存と同期対象）。[確認記録](docs/records/2026-11-06-issue-49.md)。PR #79の表示修正：[再確認](docs/records/2026-11-06-issue-49-review.md) Issue #112：準備の完了・後回し・両画面の即時更新と保存済み体験用予定の移動を `packages/server/tests/digest.emulator.test.ts`・`packages/web/tests/digest.browser.mjs` で確認（[記録](docs/records/2026-11-07-issue-112.md)）。 PR #117の再確認：版ごとの再送と繰り返す後回し・時刻の重なりを試験（[レビュー対応](docs/records/2026-11-07-issue-112.md#pr-117のレビュー対応2026-11-07-6時台)）。 PR #117の再見直し：別操作の競合409・同一操作の再送と画面の案内を確認（[追加記録](docs/records/2026-11-07-issue-112-rereview.md)）。 Issue #124：文言を点検し、関連ブラウザ試験と1280/390幅で確認（[記録](docs/records/2026-11-07-issue-124.md)）。
- [x] C25 〈未定〉 決めた準備の予定が、学生の時間割とGoogleカレンダーに入る。確かめ方：画面と実物または体験用カレンダー → Issue #49の案A・合格範囲に従い、`packages/web/tests/plans.browser.mjs` で時間割と保存済み体験用予定の作成・取消、`packages/server/tests/plans.emulator.test.ts` で実物用の同期対象と版、`packages/extension/tests/calendar-sync.test.ts` で偽APIへの作成・取消・再試行を確認。実物への書き込みは未確認（C15）。[確認記録](docs/records/2026-11-06-issue-49.md)。PR #79の表示修正：[再確認](docs/records/2026-11-06-issue-49-review.md) Issue #112：準備の完了・後回し・両画面の即時更新と保存済み体験用予定の移動を `packages/server/tests/digest.emulator.test.ts`・`packages/web/tests/digest.browser.mjs` で確認（[記録](docs/records/2026-11-07-issue-112.md)）。 PR #117の再確認：版ごとの再送と繰り返す後回し・時刻の重なりを試験（[レビュー対応](docs/records/2026-11-07-issue-112.md#pr-117のレビュー対応2026-11-07-6時台)）。 PR #117の再見直し：別操作の競合409・同一操作の再送と画面の案内を確認（[追加記録](docs/records/2026-11-07-issue-112-rereview.md)）。
- [x] C26 〈未定〉 支援担当は、自分が受け持つ学生のデータだけを読める。確かめ方：Firestoreの規則の試験（エミュレーター）→ `scripts/firestore-rules.test.mjs`、`pnpm test:firestore-rules` 32件成功（本人・許可済み・未許可・取消済み・他人・未ログイン、本人だけの文書と直接書き込み拒否を含む）。Issue #85：実演用の支援担当への共有を準備し、公開先の担当学生一覧が対象の実学生1人だけ（1/1）であることを確認（[記録](docs/records/2026-11-06-issue-85-verification.md)）。実課題の表示は未確認。Issue #98：手入力コレクションの本人・共有中の支援担当だけの読み取りと全員の直接書き込み拒否を試験とブラウザで確認（[記録](docs/records/2026-11-07-issue-98.md)）
- [x] C27 〈未定〉 面談の前のまとめを出す。〔削れる〕 → 面談画面の「① 確かめる」（前回の約束・前回の面談からの変化・次の面談までの締切）を、面談の前のまとめとする（2026-11-06、Soraが確認）。PR #51、`packages/web/tests/session.browser.mjs`、画面：`docs/records/2026-11-06-session-split/check-wide.png`

### お知らせの文章（Gemini）

- [x] C28 〈未定〉 お知らせの文章から締切の変更を拾い、課題にひも付けて要確認にする。課題の締切の欄は書き換えない。→ `pnpm test:announcements:emulator`、`packages/server/tests/announcements.emulator.test.ts`（架空のお知らせ・要確認だけの保存・同時再送・解析失敗/待機中の観測更新・公式締切の保持）。実物のお知らせは無効のまま。Issue #84：`pnpm test:demo-announcements:emulator`（先生役の投稿→DOMから送信→学生・面談の要確認、公式締切維持、重複・やり直しを偽Geminiで確認）。[画面と記録](docs/records/2026-11-06-issue-84-verification.md)。公開先の有効化・実物のGeminiは未確認
- [x] C29 〈未定〉 架空のお知らせ30件で、指標M3を測れる。〔削れる〕 → `pnpm metrics:m3`（架空30件、再現率・適合率とも100%、30回・19,410トークン。`docs/records/2026-11-06-m3.md`）。作った本人に未知の確認用の見本での測定は別のIssue
- [x] C30 〈未定〉 別の大学のLMSのページを保存して渡すと、Geminiが読み取り方の下書きを作り、人が確かめてから `lms-definitions/` に取り込める。確かめ方：模擬LMSのページから下書きを作り、その下書きで取得の試験が通る → Issue #46、`pnpm definition:check docs/records/2026-11-06-issue-46-definition.json`（Gemini実測の下書きで既存試験5件成功）。[実測記録](docs/records/2026-11-06-issue-46.md)

### 模擬LMSと試し方

- [x] C31 〈未定〉 架空の授業と課題を載せた模擬LMS（CoursePowerとは違う作り）をFirebase Hostingに置く。確かめ方：公開したURL → Issue #59、[公開先の確認記録](docs/records/2026-11-06-issue-59-resumed.md)（Hostingの `/demo-lms` で学生ログイン・架空の授業と課題・先生役の締切延長を確認）
- [x] C32 〈未定〉 模擬LMSは、`lms-definitions/` に読み取り方を1つ足すだけで取得できる。確かめ方：試験 → `packages/core/tests/demo-lms.test.mjs`、`packages/web/tests/demo-reader.test.mjs`、`packages/web/tests/demo.browser.mjs`（描いたDOMのouterHTML→共通reader→観測API→学生・面談画面、先生役の締切延長と応答を失った再送を確認）。記録：`docs/records/2026-11-06-issue-19-calendar-integration.md`。Issue #68：定義と詳細の見出し・位置を維持した手順表示とリセット後の読み取りを `packages/web/tests/demo-reset.browser.mjs`・既存M6で確認（[記録](docs/records/2026-11-06-issue-68-verification.md)）
- [x] C33 〈未定〉 試す人のための学生と支援担当のアカウントがあり、拡張機能を入れなくても一連の操作をブラウザで試せる。確かめ方：入れていないブラウザで操作 → Issue #59、`packages/web/tests/demo-live.browser.mjs`（公開先・3組6文脈・学生と面談の即時更新・他組不変・別組の読み取り24通りを拒否）。[操作結果と画像](docs/records/2026-11-06-issue-59-resumed.md)。Issue #89：`packages/web/tests/demo.browser.mjs`（Auth・FirestoreエミュレーターとChromiumで、体験用でないアカウントへの案内・ログアウト・体験用ログイン欄への復帰を確認）。`pnpm metrics:m6` 8/8（2026-11-06、PR #90取り込み後） Issue #101：ローカル・公開先用seedの初期化をリセットと共通化し、日本日付+3日の17時を固定時刻の試験で確認（[記録](docs/records/2026-11-07-issue-101.md)）。公開先用seedは未実行。
- [x] C34 〈未定〉 「先生が締切を延ばす → 学生がLMSを開く → カレンダーと面談画面が変わる」が最後まで通る。確かめ方：指標M6 → Issue #47、ローカル・公開先とも8/8（体験用カレンダー。保存済み予定・版と再送時の不変も照合）。[公開先の操作結果と画像](docs/records/2026-11-06-issue-47-live.md)。体験用カレンダーで通った分を合格とする（D23「C34の合格の条件」、D29。2026-11-07にSoraが確定）。実物の経路はC43で別に確かめる Issue #101：夜中・9時境界・日中の固定時刻でリセットがM6の日付の期待と一致。ローカルM6 2/8→8/8（[記録](docs/records/2026-11-07-issue-101.md)）。
- [ ] C43 〈Sora〉 実物の経路「YNUのLMSを開く → 裏の取得 → 台帳 → 実物のGoogleカレンダー → 学生の画面と面談画面」が、本人の実物で最後まで通り、実演と動画で見せられる。確かめ方：[実機の手順](docs/records/2026-11-06-issue-69-real-flow.md)（C04・C05・C15・C16・C21を同じ回で確かめる）

### 提出

- [x] C35 〈未定〉 READMEに、動かし方、試し方、構成の図、使ったGoogleのサービスを書く。確かめ方：READMEだけを読んで、別の人が試せる → Issue #48、別系統のClaudeが公開先で学生・支援担当の手順1〜6をすべて成功（2026-11-06）。案内の修正・試用結果・アカウントを伏せた画面：[確認記録](docs/records/2026-11-06-c35-readme-trial.md)
- [ ] C36 〈未定〉 提出用のrepoへ、公開してよい内容だけを送る。確かめ方：公開の点検（個人の事情、実際の課題のデータ、秘密の値が無い）
- [ ] C37 〈Sora〉 説明資料を公式のテンプレートの項目1〜9どおりに書き、Googleドライブのフォルダに置く（文章の下書きはClaude）。確かめ方：項目がそろい、ログインしていないブラウザでフォルダが開ける
- [ ] C38 〈Sora〉 デモ動画を撮り、同じフォルダに置く。確かめ方：実際の操作を撮ったもので、筋書き（C34）が映っている
- [ ] C39 〈Sora〉 著作物利用シートを作る。確かめ方：`docs/third-party.md` の全行がシートにある
- [ ] C40 〈Sora〉 会場のGoogleフォームに、GitHubのURLとフォルダのURLを出す。確かめ方：送信の控え
- [ ] C41 〈Sora〉 デプロイ先を 2026-11-14 まで動かす。確かめ方：11/14に、試す人のアカウントで筋書きが通る
- [ ] C42 〈Sora〉 ピッチのスライドを作り、同じフォルダに置く（文章と構成の下書きはClaude）。確かめ方：提出の締切までにフォルダにあり、ログインしていないブラウザで開ける

## 指標

測って改善していく数字。測り方を変えたら、前の値と比べられないことを書き添える。

| ID | 指標 | 今の値 | 目標 | 測り方 |
|---|---|---|---|---|
| M1 | YNUの見本で、題名・締切・提出の状態を正しく読めた項目の割合 | 30/30（100%、`pnpm metrics:m1`、2026-11-06） | 100% | 見本と手で作った正解を比べる試験 |
| M2 | PandAの見本で、同じく正しく読めた割合 | 未測定 | 100% | 同上（orange） |
| M3 | お知らせから締切の変更を拾えた割合（再現率）と、拾ったうち正しかった割合（適合率） | 再現率100%（18/18）、適合率100%（18/18）。初回・作成者既知の30件、未知の確認用は未実施（[記録](docs/records/2026-11-06-m3.md)、2026-11-06） | 再現率90%以上、適合率95%以上 | 架空のお知らせ30件 |
| M4 | LMSを開いた回数のうち、裏の取得が最後まで済んだ割合 | 未測定 | 95%以上 | 拡張機能が手元で数える（回数と成否だけ。SIDや課題の中身は残さない） |
| M5 | LMSを開いてから、学生の画面とカレンダーに変化が出るまでの時間（中央値） | 未測定 | 30秒以内 | M4と同じ記録の時刻から |
| M6 | 試し方の筋書き（C34）の手順のうち通った割合 | ローカル8/8（100%、2026-11-07、Issue #101。午前7時台の同じ試験で修正前2/8→修正後8/8、[記録](docs/records/2026-11-07-issue-101.md)）・公開先は既存記録8/8（PR #81、`trial-3`、今回未測定）。体験用カレンダー。実物のGoogleカレンダーは対象外 | 100% | 筋書きを自動で流す試験 |
| M7 | 実際の課題で、手で作った一覧に対して自動で拾えた割合 | 未測定 | 100% | 一覧は手元だけに置き、割合だけをここに書く |

## 日程の目安（案）

| 日 | 終えたいもの |
|---|---|
| 11/6 | C02、C03（見本での読み取り）、C10〜C13（台帳） |
| 11/7 | C04〜C07、C14〜C17（裏の取得、Cloud Run、カレンダー） |
| 11/8 | C18〜C26（学生の画面、面談画面） |
| 11/9 | C28〜C34（お知らせの文章、別の大学を足す流れ、模擬LMSと試し方） |
| 11/10 | C35、C36。19:00に提出 |

## 条件の変更

| 日 | 変更 | 理由 |
|---|---|---|
| 2026-11-05 | C01〜C36を置いた | 最初の計画 |
| 2026-11-06 | C30を必須にした。C03に、全授業の課題の一覧がLMSに無いことを書いた | C30は、別の大学へ広げるときの入口になるため（Sora）。36個すべてを終える前提で進める |
| 2026-11-06 | C37〜C41（提出物）を足した | 完成条件をすべて満たしても、提出一式がそろわないため（FableとAstraの見直し、D23。Soraが合意、orangeは後でレビュー） |
| 2026-11-06 | C28 の〔削れる〕を外し、必須にした | 延長や前倒しがお知らせの文にだけ書かれることがあり、利用者が見落とす変化を拾う役目があるため（D23。Soraが合意、orangeは後でレビュー）。D11の削る順の③はC29だけにした |
| 2026-11-06 | C25の未決の承認フローをIssue #49の案Aに更新。試験は実物または体験用カレンダー | Issue #49の最新コメントと作業依頼に従う。学生と支援担当が保存でき、登録者表示と学生による取消でD13を守る。orangeの合意はmerge前 |
| 2026-11-07 | C42（ピッチのスライド）を足した | 東京の現地会場に申し込んだチームは提出が要る（`docs/submission.md`）のに、完成条件とIssue #22から漏れていたため（Soraが合意、D29。PR #50を置き換え） |
| 2026-11-07 | C34を体験用カレンダーで合格とし、実物の経路をC43として足した | 審査員が触る体験版と、本人の実物の経路を分けて確かめるため（D23、Sora。D29によりSoraの合意で確定） |
