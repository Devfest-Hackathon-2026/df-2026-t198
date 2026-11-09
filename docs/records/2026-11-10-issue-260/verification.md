# Issue #260：準備の予定を断る理由

2026-11-10の日本時間04時台に、架空の学生・授業・課題とローカルのAuth/Firestoreエミュレーターで確認した。公開先・実際のLMS・Googleカレンダーは対象外。最初にorigin/main（ce49511）を取り込んだ。

## 変更

- 保存時の409を、授業・準備の重なり・過去・利用できない課題・締切後・同じ予定の食い違いに区別する。応答には固定コードだけを返す。契約は [data-shapes.md](../../data-shapes.md#準備予定の保存と取消issue-49)。
- 学生の手入力と面談の候補は共通のフォームで理由を表示する。対象課題が一覧から消えても断った理由を残す。メールの後回し・見本作成もコードを維持する。文は [ui-words.md](../../ui-words.md#準備の予定を断る理由issue-260)。
- 古いメールリンクを開いたときは、現在の日時・状態と「変更していません」を状態通知に含める。同じ版での再送・応答喪失後の再試行・現在の予定の返却は保つ。
- 複数の画面を操作する試験で、遷移のアニメーションが中断された際の未処理の例外を確認した。`use-pathname.ts` で `ready` の拒否も処理する1行を追加した。中断時に `ready` が拒否されることは [W3Cの仕様](https://www.w3.org/TR/css-view-transitions-1/#dom-viewtransition-ready) と一致する。模擬した中断で未処理の拒否が出る試験を先に確認し、修正後は画面の移動とブラウザ例外0件を確認した。

## 先に確認した失敗

- HTTPの追加試験は、新しい4コードがすべて `plan-conflict` になるため4件失敗した。フォームの追加試験も同じ理由で4件失敗した。
- 保存のエミュレーター試験は、理由別コードを返さず8件失敗した。保存・同期対象を増やさない検査は維持した。
- 課題が一覧から消えるとエラーも消える試験は1件失敗した。修正後は候補・手入力の両方で通知が残る。
- 古いリンクの状態通知に「変更していません」がない試験は2件失敗した。修正後は現在の状態と日時を通知する。

## 確認結果

| 確認 | 結果 |
|---|---|
| 指定6検査 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` が終了0。最終実行は全体に `TZ=UTC` を指定 |
| 通常のパッケージ試験 | core 274、extension 509、server 331、web 236件成功。別起動が必要な試験等は148件skip |
| 理由表示・古いメールリンク・画面移動の単体試験 | 関連5ファイル38件成功。日本時間の通常設定とUTCで確認 |
| 保存のエミュレーター | `TZ=UTC pnpm test:plans:emulator`、21/21。理由別のコード・部分保存なし・隣接・短時間・取消後・同時保存・同じIDの食い違いを確認 |
| メール操作のエミュレーター | `RUN_DIGEST_EMULATOR_TESTS=1 pnpm --filter server exec vitest run --testTimeout=20000 tests/digest.emulator.test.ts`、38/38。後回し・再送・利用できない課題の拒否と保存状態の維持を確認 |
| 面談のエミュレーター | 2/2成功 |
| 画面操作 | [28/28](ui-operations.json)、ブラウザ例外0件。比較元は同じPRの11/9の28/28 |
| M6 | [8/8](m6.json)。比較元は同じPRの11/9の8/8。体験用カレンダーのみ |
| 面談ブラウザ | [26操作](session-operations.json)・[8画面](session-views.json)、ブラウザ例外0件 |
| メールブラウザ | [18操作](mail-operations.json)、ブラウザ例外0件。後回し、古いリンク、再試行、締切後の文、両画面の更新を確認 |
| 見本 | 17ファイル成功。実物との比較は対象データなしのためskip |
| 文言 | kuchiguseの観点で決め台詞・標語がないことを点検。yomiyasuのlint・資料との照合・最終稿のハッシュ照合を実施。Argonでの確認は未実施 |

ブラウザ・エミュレーターは `TZ=UTC`。いずれも日本時間の0:00〜9:00に入る時刻で実行した。通常設定での6検査も成功後、追加修正を含めてUTCで再実行した。エミュレーターのポート競合で起動できなかった回と中断した回は成功数に含めず、空くまで待って新しく実行した。

ブラウザの再現コマンドは、`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs` を指定し、`pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore '<runner>'`。runnerは順に `node packages/web/tests/run-plans-browser.mjs --judge-qa`、`node packages/web/tests/run-demo-browser.mjs`、`node packages/web/tests/run-session-browser.mjs`、`node packages/web/tests/run-digest-browser.mjs`。`ARTIFACT_EVIDENCE_DIR` で出力先を分けた。

メールのブラウザ試験では、現在の画面に合わせて折りたたみ・受信箱・確認ダイアログ・面談表の課題ボタンを開く手順を補った。通知の検索は操作欄に限定し、完了印はチェック記号も含む部品を選ぶ。締切の境界試験は、曜日によって授業と重なる3限を避け、架空の時間割に授業がない5限を明示して使う。保存・再送・締切・本文・保存件数の判定と既存の見本の正解は変更していない。

## mainの取り込み

`PLAN.md` のC23・C24の確認記録が衝突した。C23はmainのスマホ表示の記録を残し、C24はこのPRの重なり防止の記録を残した。どちらの確認記録も失わないための解消で、完成条件は変更していない。

C24は完了済みのまま今回の証拠を追記し、`pnpm progress --write` で全体36/43・必須32/39を確認した。

## 残件

- 追加の `pnpm test:plans:browser` は、前回と同じ `plans.browser.mjs:62` の `assertCompactCell`（予定名等の各要素が1行に収まる検査）で失敗した。関連CSSと当該試験はorigin/mainから無変更。前回の [基点でも同じ失敗が出た記録](../2026-11-09-issue-260/verification.md#残件) を維持し、この表示の折り返しは今回の理由表示の範囲外として残す。
- 画面の言葉の決まりで指定されたArgonの実行手段は、この環境のツールにないため未実施。追加commitのClaudeによる見直しと合わせて統合役に引き継ぐ。
- merge・デプロイ・実物のLMSやGoogleへの操作は行っていない。
