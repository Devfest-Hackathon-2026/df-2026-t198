# LMS取得後のカレンダー同期の接続

目的は、LMSから取得した観測をAPIが受理した直後、既存の専用Googleカレンダーへの同期を起動すること。観測を拒否された回はカレンダーへ書かず、カレンダーの失敗で受理済み観測を失敗扱いにしない。

基点はmain `bd47aa7`。`collection-worker.ts` はAPIへ直接観測を送り、受領を検証してから終了していた。設定画面とworker起動時の同期は接続済みであり、今回の変更は取得後の呼び出しだけを足す。

変更は `packages/extension/src/collection-worker.ts` の既存同期関数のimportと非同期の起動、および `packages/extension/tests/collection-calendar-flow.test.mjs`。既存の `collection-worker.test.ts` では同期のモックを明示し、不完全な認証モックの例外を握りつぶして通る状態を避ける。API・型・依存・権限を変更しない。専用カレンダーIDと本人一致、予定の所有マーカーの検証は既存関数を使う。

受入は実workerを束ねた架空応答の試験で判定する。取得後の同期、観測拒否時は同期要求もしないこと、Google側の失敗後も観測成功を維持すること、Calendarの応答待ちでも観測結果と取得状態が返ることを確認する。隔離コピーの未接続版は2件失敗・1件成功。同期をawaitする版では、応答待ちの試験が失敗した。非同期に起動する版では4件成功。別の管理対象worktreeへ移した後も拡張全体の試験・型・lint・buildを実行する。

確認コマンドは `pnpm --filter @kadai-hisho/core build`、`pnpm --filter extension test`、`pnpm --filter extension typecheck`、`pnpm --filter extension lint`、`pnpm --filter extension build`。取り込み前にはrepo所定の全体検査と別系統の見直しを行う。

試験は実LMSやGoogleへ接続せず、値は架空。実機確認は、全未同期課題が既存専用カレンダーへ同期され得る範囲を本人に伝えてから行う。新たな権限・API・データ形・課金変更が必要なら、その部分で停止する。

同時作業中のmainと作業ツリーを保護するため、管理対象の別worktreeを採用した。同期の未接続は完了条件を妨げる必須修正。新たな同期基盤や依存は加えず、既存の本人確認・同期状態・再試行を利用する。残るリスクは実際のLMS、Google、worker寿命であり、単体試験の成功を実機成功とは扱わない。
