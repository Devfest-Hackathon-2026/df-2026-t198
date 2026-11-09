# Issue #249 検証記録

比較元は作業開始時の `397da2f`。Auth・FirestoreエミュレーターとChromiumを使い、架空の授業・課題だけで確認した。merge・デプロイ・実物のLMSへの接続は行っていない。

## 時間割

同じ長い授業名・英語付きの授業名・同じコマの2授業を変更前後で使用。週末を含むケースは日曜7限まで表示した。変更前は全4ケースで画面内に収まらず、最初の行だけ約469〜513pxに伸びた。変更後は全4ケースで全行が同じ高さになり、表全体が横・縦のスクロールなしで収まった（[前](before.json)、[後](after.json)）。前のJSONの `width` は表自体の実測幅で、画面幅は画像名に対応する。

| 画面 | 平日5限の変更前後 | 週末7限の変更前後 |
|---|---|---|
| 1280×800 | [前](before-student-weekday-1280.png) / [後](after-student-weekday-1280.png) | [前](before-student-extended-1280.png) / [後](after-student-extended-1280.png) |
| 390×844 | [前](before-student-weekday-390.png) / [後](after-student-weekday-390.png) | [前](before-student-extended-390.png) / [後](after-student-extended-390.png) |

`student-fit.browser.mjs` で全文のtitle・読み上げ名、2行までの授業名、1行の締切、課題の詳細、共有の追加・取消、体験学生・体験支援担当・担当学生のいる通常の支援担当、ログアウトを確認。更新が古い案内が増えた場合も画面内に収まることを確認した。`student.browser.mjs` では締切順・提出と終了・開いたままの更新・学期外と時限なしの授業・狭い画面の詳細操作を確認した。

## 体験の入口

設定なし：[1280pxの前](before-demo-lms-1280.png) / [後](after-demo-lms-1280.png)、[390pxの前](before-demo-lms-390.png) / [後](after-demo-lms-390.png)。設定あり：[1280px](after-demo-lms-configured-1280.png) / [390px](after-demo-lms-configured-390.png)。審査用の欄は初め閉じており、開けば入力できる。リンク失敗時は開いて回復できる。

## 試験

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：すべて終了コード0。core 274・extension 509・server 312・web 215件が成功。既定のserver 128件・web 2件はskip。見本17ファイルが成功し、実物との比較は手元資料がないためskip。
- 審査QA：比較元は共通資料の28/28、今回も28/28（[結果](qa/operations.json)）。M6：PLAN.mdの比較元8/8から今回8/8（[結果](m6/m6.json)）。既存の分母・手順・保存数・再送の判定は維持した。
- `pnpm test:public-demo:browser`：成功。役割別の入口、ログイン失敗、締切変更と支援担当の即時更新、上限の案内、やり直しを確認した。
- 審査リンク18項目（[結果](judge-links/judge-links.json)）、授業色14項目（[結果](colors/after.json)）、手入力課題9項目（[結果](manual/operations.json)）が成功。追加したブラウザ試験と学生の既存試験も成功。
- KULASISの表示試験：成功。架空CP932から観測APIを通して学生1280/390px・面談で対応したコマと未対応の授業を確認し、ブラウザの例外0件。

エミュレーターポートが使用中の回は待機した。複数の試験を同じエミュレーターで順に実行するときは、各runnerが別のパスワードを作るため、試験間でローカルのAuth・Firestoreを初期化した。実物のアカウントやデータは扱っていない。

## 変更の判断

授業名で高さを決めず、残りの画面高を時限数で等分する。同じコマの授業はその内側を縦に分ける。全文と詳細は押した先に残す。既存の授業色は同じ割当を使う。スマホの省略量と小さい文字は画像で人の確認が必要。

面談の入口は既存の共有許可・体験プロフィール・担当学生APIを使う。判定前や利用者切替時には出さず、古い購読・遅い応答を無視する。入口の表示は権限を与える処理ではなく、APIとFirestoreの権限は変更していない。外部入力の授業名はReactの文字列として描画する。秘密の保存・出力、依存・課金・デプロイの変更は対象外。

試験では閉じた審査欄を開く操作を追加。学生の旧「幅115px以上」は依頼のスクロールなしの条件へ置き換え、日付を見本の週に固定しタブの移動を明示した。手入力の試験は現在の見出し・課題の表・やり直しの確認操作に合わせ、KULASISの試験は時限なしの欄を正確に指定した。正解データや締切境界、保存数、共有取消の判定は変更していない。[文言の点検](copy-review.md) はArgonの指摘なし。yomiyasuの「版」と例示の数値は依頼と表示例を確認して維持した。
