# Issue #44 の確認

LMSを使う学生に、観測の受領応答で確かめた変更の件数だけを知らせる。ページの隅の1行と、拡張機能のポップアップのボタンから、同じFirebaseプロジェクトの既定Hostingの `/student` を開く。

## 確かめた範囲

- `packages/extension/tests/collection-worker.test.ts`：応答の変更有無と件数の受け渡し。実装前は2件失敗し、実装後は成功。不正・矛盾する件数は通知に渡さない。
- `packages/extension/tests/collection-flow.test.mjs`：架空のLMSを裏で取得する経路と、ページ側へ切り替える経路の両方で、観測の送信から1行の表示まで確認。既存の読み取り見本と正解は変更していない。
- `packages/extension/tests/change-notice.test.mjs`：変化ありの1行、変化なし・失敗・不正な応答でDOMを追加しないこと、同じ学生画面へのリンク、ボタン1つ、未設定時の無効化。
- `packages/extension/tests/probe-build.test.mjs`：架空の設定だけで実ビルドし、manifestにポップアップが登録され、HTML・CSS・JSが同梱されることを確認。
- `packages/extension/tests/change-notice.browser.mjs`：実Chromiumで架空のページを操作。1行を押して学生画面が開くこと、LMSのURL・入力・focus・layoutの維持、LMS側のCSSとの分離、390px幅、参照元URLを送らないこと、ポップアップのボタン1つと遷移を確認。通信先はすべて架空の応答に置き換え、実LMS・本人のアカウントには接続していない。

2026-11-06に `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples` が終了コード0。拡張機能96件、Firestore規則38件が成功。全体試験のうち別用途のエミュレーター専用試験21件は既定どおりskip。`check:samples` は17ファイル成功、手元の実資料との比較は資料がないためskip。Webのビルドには既存のbundleサイズ警告がある。

ブラウザ試験の実行方法（Playwrightは既存の手元のものを使い、依存に追加しない）：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
ARTIFACT_EVIDENCE_DIR=/tmp/kadai-i44-evidence \
node packages/extension/tests/change-notice.browser.mjs
```

幅1280px・390pxの知らせとポップアップの画像を `ARTIFACT_EVIDENCE_DIR` に保存する。画像を開いて、1行の知らせとボタンの表示も確認した。これは実際のChrome拡張をインストールした確認ではなく、ビルドしたコードにChromeの通信応答を代入したブラウザ試験。

## Soraが行う実LMSの確認

[Issue #43の手順](2026-11-06-issue-43-verification.md#soraが行う実機確認)のあとに、同じ拡張機能・同じアカウントで行う。新しいクラウドのリソースや課題は作らない。

1. 同じ設定でビルド・再読み込みする。`firebase.projectId` の既定Hostingに学生画面が置かれていることを確かめる。未設定なら通知は出ず、ポップアップのボタンは無効になる。
2. 課題の変更が受理された回に、LMSの右下に「課題の変更が○件あります。学生の画面を開く」が1行だけ出ることを確かめる。カレンダーの反映済みとは表示しない。入力途中の文字、スクロール、授業の操作を妨げないことも見る。
3. その1行を押し、学生画面が別のタブで開き、元のLMSが移動しないことを確かめる。リンク先にSIDなどが入っていないことを見る。URLや実際のデータは記録に貼らない。
4. 変更のない状態でLMSを開き直し、知らせが出ないことを確かめる。ログインを促す表示も出ない。
5. 拡張のアイコンからポップアップを開く。ボタンが1つだけで、押すと同じ学生画面が開くことを確かめる。接続テストは従来どおり拡張の設定画面にある。

結果は成否と件数だけをIssue #44へ残す。C22は自動試験とブラウザ操作で確認。C21は実LMSでの確認が残るため、PLANのチェックを付けない。M4（裏の取得の成功割合）・M5（画面とカレンダーまでの時間）・M7（実課題の取得割合）は未測定。M1〜M3の読み取り・抽出、M6の模擬LMS全体の筋書きは今回の変更の対象外。
