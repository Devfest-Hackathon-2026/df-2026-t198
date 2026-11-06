# Issue #40 実カレンダーの確認手順（未実施）

実行する人：Sora。対象は本人のChromeプロファイルと、拡張機能の接続テストで作った専用カレンダー。実際のLMSの課題は使わない。この手順の成功後にC15を更新する。C16・C17の偽API試験とは別の確認。

## 前提

1. このPRのサーバーを、利用が許可されたHTTPSのAPI接続先にデプロイしてあること。新しいCloudリソースをこの手順で作らない。
2. `packages/extension/config.local.json` の既存の公開用Firebase設定に `apiOrigin` を追加する。値はAPIのorigin（`https://` から始まるホスト名、パスなし）。この設定は手元だけに置き、内容やtokenをIssueに貼らない。
3. `pnpm --filter extension build` で作った拡張機能をChromeで再読み込みする。API通信先1か所へのhost permissionが増えることを確認する。GoogleのOAuth scopeは既存の `calendar.app.created` のまま。
4. 設定画面で接続テストを行う。既存の専用カレンダーを使う。作成結果が不明と表示されたら繰り返さず、接続テストの復旧手順に従う。

## 架空の課題を送る

拡張機能の**設定画面**で開発者ツールのConsoleを開き、次を実行する。LMSや普通のWebページからのメッセージは拒否される。認証情報を取得・表示する操作は不要。

```javascript
const calendarCheck = {
  schemaVersion: 1,
  observationId: crypto.randomUUID(),
  system: 'demo-lms',
  definitionId: 'manual-calendar-check',
  definitionVersion: 1,
  fetchedAt: new Date().toISOString(),
  catalogCourses: [{ courseId: 'manual-calendar-check-course', name: '架空の同期確認授業', slots: [] }],
  courseResults: [{ courseId: 'manual-calendar-check-course', listComplete: true,
    seenSourceIds: ['manual-calendar-check-task'] }],
  assignments: [{ courseId: 'manual-calendar-check-course', sourceId: 'manual-calendar-check-task',
    title: '架空のカレンダー確認課題', url: 'https://example.invalid/calendar-check',
    submission: 'not-submitted',
    deadline: { kind: 'date', date: '2026-11-12', dueText: '11月12日まで', timeZone: 'Asia/Tokyo' } }],
  failures: []
};
const sendCalendarCheck = () => chrome.runtime.sendMessage({ type: 'observation-send',
  observation: { ...calendarCheck, observationId: crypto.randomUUID(), fetchedAt: new Date().toISOString() } });
await sendCalendarCheck();
await chrome.runtime.sendMessage({ type: 'calendar-sync' });
```

観測の応答の `ok: true` は受領の成功。続けた `calendar-sync` の `ok: true` とGoogleカレンダーの画面も確かめる。`ok: false` なら同期待ちが残り得る。ID tokenやSDKの例外を貼らず、操作と成否だけを報告する。

- 専用カレンダーに「架空の同期確認授業：架空のカレンダー確認課題」が11/12の終日予定として1件だけある。
- 説明欄に「締切：11月12日まで」と「LMSで開く」のリンクがある。接続テスト自身の予定は別に存在してよい。
- `sendCalendarCheck()` と `calendar-sync` をもう一度実行しても、この課題の予定は1件のまま。

## 締切・提出・取消

順に実行し、各段階でGoogleカレンダーの画面を確認する。

```javascript
calendarCheck.assignments[0].deadline = {
  kind: 'datetime', dueAt: '2026-11-13T12:00:00+09:00', dueText: '11月13日 正午', timeZone: 'Asia/Tokyo'
};
await sendCalendarCheck();
await chrome.runtime.sendMessage({ type: 'calendar-sync' });
```

同じ予定が11/13正午へ移り、5分の予定になる。「締切が5分延びる意味ではありません」の説明がある。旧日付に予定が残らない。

```javascript
calendarCheck.assignments[0].submission = 'submitted';
await sendCalendarCheck();
await chrome.runtime.sendMessage({ type: 'calendar-sync' });
```

予定が残り、通知が無効になる。

```javascript
calendarCheck.assignments = [];
calendarCheck.courseResults[0].seenSourceIds = [];
await sendCalendarCheck();
await sendCalendarCheck();
await chrome.runtime.sendMessage({ type: 'calendar-sync' });
```

2回目の完全な一覧で取消になり、この架空の課題の予定だけが消える。専用カレンダーと接続テスト自身の予定は残る。

## 起動時の再試行

作成・変更の同期の途中でworkerを止めた場合は、拡張機能を再読み込みしてから専用カレンダーを確認する。保存した予定IDで再試行し、課題の予定が二重に増えない。通信の応答喪失そのものは偽API試験で再現済みなので、実物で意図的にネットワーク障害を起こす必要はない。

結果は「作成、再送、移動、提出後の通知解除、取消、再起動」の成否だけをPRに記録する。実物の確認に加え、C04の取得部品が共通の `sendObservation` を呼ぶ通し確認は別作業。要確認の両日付は、今回のcoreの試験で確認し、実LMSのお知らせからの通し確認はC28の経路ができてから行う。
