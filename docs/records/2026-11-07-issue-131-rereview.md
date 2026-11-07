# PR #132：遅い移動中の再取得を防ぐ

[Issue #131](https://github.com/shieikan/kadai-hisho/issues/131)・PR #132のClaudeの見直し3への対応。実装は `9e68839`。#121のmerge `4a8ff83` を含む `origin/main` を `89ac6d2` で取り込み、取り込み後に検査した。[初回の記録](2026-11-07-issue-131.md)はその時点の結果として残す。

## 変更

Service Workerが取得の占有を求める直前に `chrome.tabs.get(tabId)` を読み、`pendingUrl` がなく `status === 'complete'` の場合だけclaimへ進む。移動中、状態不明、APIの失敗は `not-idle` で断る。claim・LMSのGET・失敗の回数の更新は行わない。

ページ側の15秒のタイマーは再試行を要求するだけにした。タイマーが過ぎたことは、移動が止まったと判断する根拠にしない。観測・API・依存・権限・見本の正解・指標の判定は変更していない。

## 修正前と修正後

- 追加した単体11件は修正前に失敗した。タブの状態4種類×17秒・32秒の8件、タブ状態を読めない1件、`beforeunload` から実際の再試行を通す初回・`yielded` の2件。旧実装は前の9件で取得成功となり、後ろの2件では17秒後にclaimを送った。
- 修正後は拡張全体321/321成功（修正前の既存310件に11件追加）。読み込み中でも `pendingUrl` が見えない場合、`complete` でも `pendingUrl` がある場合、statusの欠落も断る。
- Chromiumでは修正前の最初の遅い移動で、17秒後にclaimが1回送られ、試験が失敗した。Chromiumで旧実装のホームGETまで観測したとは扱わない。

## Chromiumの実タブ状態

`student-priority.browser.mjs --tab-state` を実行した。PlaywrightのChromium channel（Chrome for Testing 158.0.8127.18）に一時的なMV3拡張を読み込み、実物の `chrome.tabs.query/get` を使う。host権限はLMSだけで、`tabs` 権限は付けない。製品のworker bundleはNodeのVM、content bundleはChromiumで動かし、通信と認証は架空のものだけに置き換えた。

| 操作 | 実際に返ったタブの状態 | 確認したこと |
|---|---|---|
| 初回のLMS内の移動で応答を保留 | 実時間17秒・32秒とも `loading`、`pendingUrl` あり | 取得要求は `not-idle`。claim 0回・LMS読取0回 |
| 直前が `yielded` のLMS内の移動で応答を保留 | 同上 | 10分の待ちによる見かけの拒否ではなく、移動状態で拒否 |
| 権限のない別originへの移動で応答を保留 | 実時間17秒・32秒とも `loading`、`pendingUrl` なし | statusで拒否。claim 0回・LMS読取0回 |
| 再読み込みの確認画面で取消 | `complete`、`pendingUrl` なし | 実際の `beforeunload` 1回。再試行後に取得成功 |
| 応答待ちの移動を `Page.stopLoading` で取消 | `complete`、`pendingUrl` なし | 同上 |
| 添付ファイルの応答によるダウンロード | `complete`、`pendingUrl` なし | 同上。架空ファイルのdownloadイベントと完了を確認 |

6/6ケース成功。遅い移動では応答を実時間32秒以上保留した。Playwrightでは応答待ちの古い文書に対する時計操作・評価が止まったため、遅れて届く取得要求をworkerのメッセージ入口に直接渡した。ページの15秒と2秒のタイマーからworkerへ進む経路は単体の偽タイマーで確認し、Chromiumで自動タイマーが発火したとは扱わない。取消・ダウンロード後の再試行はブラウザの時計を進めて確認した。

試験の起動例（手元にあるPlaywrightのmoduleを指定する。workspaceの依存には追加しない）：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node packages/extension/tests/student-priority.browser.mjs --tab-state
```

実タブAPIの確認には、PlaywrightのChromium本体も必要。headless shellだけの環境ではPlaywrightのCLIで `install chromium --no-shell` を実行する。[Chrome Tabsの説明](https://developer.chrome.com/docs/extensions/reference/api/tabs)と[PlaywrightのMV3拡張の試し方](https://playwright.dev/docs/chrome-extensions)を参照した。

## 連続試験の初期化

main取り込み後の連続実行は、7回成功後の8回目にページ側の `slow-link` で初回取得の待機が切れた。学生の操作前で、LMS読取は最初の画面表示の1回だけ、取得状態は未設定だった。同じ取得開始を30回切り出すと再発せず、原因は断定していない。

ブラウザ試験の最初の無操作2秒をPlaywrightの時計で明示的に進め、その直後に実時間へ戻す形にした。学生の操作、遅い移動の待機、15秒の操作待ちの判定、返事なし・Enterの判定は保つ。取得要求の回数と最後の応答も、待機失敗時の診断に足した。この初期化で20ケースすべて成功した後、20回の連続実行を最初からやり直した。

## 検査と指標

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：main取り込み後に成功、終了コード0。Hosting 8件・Firestore規則44件のエミュレーター試験を含む。既定でskipするserver/webのエミュレーター試験60件は実施済みと数えない。
- `pnpm --filter extension test`：321件成功。上の `pnpm test` でも同じ321件が成功。
- M1：PLANの30/30（100%）に対し、main取り込み後の `pnpm metrics:m1` も30/30（100%）、余分な課題0件。`check:samples` は17ファイル成功。手元の実物との比較は入力がないためskip。
- M4・M5・M7は実LMSで測っていないため未測定。M2・M3・M6は変更対象外。Web buildの500kB超の警告は残る。
- 通常の `student-priority.browser.mjs`：初期化変更 `15f4759` 後に20ケースを20回連続成功（計400ケース、各回の終了コード0）。取得部品2ファイルとブラウザ試験のSHA-256が各回で不変だったことも確認した。連続実行は388.6秒。返事なし・Enterも20/20成功。

## 残る確認

C04・C05は実LMSでの確認待ちのため未完了。完成条件は全体31/43・必須29/39を保つ。実LMS、実Googleアカウント、デプロイ、提出用repoは触っていない。状態を確認できない場合は取得せず、次の操作などによる再試行を待つ。Claudeの再見直しとmerge、merge後のSoraによる実LMSの確認を残す。実行役はPRをmergeしない。
