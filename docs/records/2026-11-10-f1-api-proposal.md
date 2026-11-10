# F1 (a) 観測応答の変更案（合意待ち・未実装）

## 型・API

`POST /api/v1/observations` の既存3項目を保ち、任意の `deadlineChanges` を追加する案。以下は案であり、coreの型と実行コードには追加していない。

```ts
interface ObservationResultProposal {
  status: 'applied';
  changed: boolean;
  changeCount: number;
  deadlineChanges?: Array<{
    changeId: string;
    assignmentKey: { system: 'ynu-lms' | 'kulms' | 'kulasis' | 'demo-lms'; sourceId: string };
  }>;
}
```

新しい受領では `deadline-changed` の変更だけを配列に入れ、0件なら空配列。旧サーバーと古い受領記録では省略可能。省略を締切変更なしの確定結果としては扱わず、既存の課題全般の案内だけを使う。題名・URL・before/afterは応答に増やさず、学生画面で既存の課題・変更履歴を読む。

## Firestoreの構造とrules

`students/{uid}/observationReceipts/{observationId}.result` に上の配列が入る。新しいコレクションは作らず、changes/assignmentsの保存形式も変えない。旧受領記録を遡って書き換えない。受領と履歴を同じトランザクションで保存し、再送は同じchangeIdと課題キーを返す。現行rulesは受領記録を本人だけに許可するため、rules変更は不要の案。

## 理由と採らなかった案

現行のchanged/changeCountは新規・改題・提出等を含むため、「締切が変わりました」とは言えない。kindと課題キーを含む最小の応答を使えば、既存の認証と送信経路を再利用できる。

- 拡張がFirestoreの履歴を別取得する案：依存なしでもREST認証、購読範囲、観測との対応、再試行が増える。今回の取得応答を使う案より実装が広い。
- 拡張に前回の全課題を保存して差分を取る案：初回、端末切替、アカウント切替、サーバーの適用順、読めない締切に対する挙動が台帳とずれる。独立した台帳は作らない。
- 既存の件数を締切変更件数と呼ぶ案：新規と締切変更を区別できないので不採用。
- メール案：本人の方針に従い既定にしない。現在の朝・準備前の配信契約とは別の合意が必要。

## 合意が必要な箇所

応答と受領記録の追加項目、旧受領の扱い、バッジ解除条件、複数課題の遷移先、学生画面の課題指定URLの契約を決めるまで拡張・サーバーには実装しない。案は、取得中・失敗の表示を優先し、正常終了後に締切変更の件数を表示する。既定popupがあるので、単にonClickedを追加しても直行できない。通知がある場合のpopup変更と通常の入口の両立も合意対象。

## 試験案

既存契約の限界は `packages/core/tests/deadline-notice-contract.test.ts` で実行検証する。提案した拡張側の挙動は同ファイルのtodoで明示し、成功件数には数えない。

合意後には、締切延長・前倒し・複数件、初回・改題・提出・変更なし、同一observationId再送、旧応答・旧受領、サーバー失敗、アカウント切替、取得中バッジとの競合、通常popup、課題指定リンクを偽APIで試す。その後、作り直したZIPで実LMSの取得→表示→課題確認を別途実施する。
