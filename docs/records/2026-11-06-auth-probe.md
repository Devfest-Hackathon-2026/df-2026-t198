# 拡張機能のログインとカレンダーの実物での確認（2026-11-06）

記録。書き換えない。設計案 [design.md](../design.md) の4節・5節で「まだ確かめていない」としていたことを、Soraのchromeで確かめた。部品はPR #11（`spikes/auth-probe.md` の手順）、直しはPR #12。

## 確かめたこと

| 段 | 結果 |
|---|---|
| 拡張機能のID | manifest の公開鍵で固定したID（`ghlhpjencbpglkbjmhadcbjgjpngdhll`）が、chromeの読み込み画面のIDと一致した |
| Googleでのログイン | `chrome.identity.getAuthToken` で、`openid`・`email`・`calendar.app.created` の許可が取れた（OAuthの同意画面は外部・テストモード、テスト利用者はSora） |
| Firebaseへのログイン | MV3のservice workerで、esbuildのIIFEに束ねた `firebase/auth/web-extension` の `signInWithCredential` が通り、uidが得られた |
| 専用カレンダー | `calendar.app.created` の範囲で、専用カレンダー（「課題の秘書・接続テスト」）を作り、予定IDを先に決めた架空の予定を1つ作れた |
| 重複しないこと | 2回目に同じ予定IDで作ると、Googleが409（既にある）を返し、中身も一致すると判定した。カレンダーの予定は1件のまま |
| 起動し直したあとの復元 | service workerを止めて別の起動にしたあと、保存したログインから同じuidに戻った（Googleでのログインのやり直しは無し） |

## 途中で見つけたこと

- 初めの実物の確認で、2回目の照合が「食い違い」になった。Googleカレンダーが予定の時刻を秒までしか返さないのに、保存した時刻がミリ秒まで持っていたため。時刻を書き方によらず同じ時刻として比べ、新しく作る予定は秒の単位で保存するように直した（PR #12）。食い違いの試験は、締切の最小の単位である1分のずれで行う。
- 製品の同期（C16）では、時刻を分の単位で作って比べれば足りる。

## まだのこと

- ID tokenでCloud RunのAPIを認証すること（APIができてから）。
- 台帳の締切から予定を作る・動かす・消すこと（C15・C16）。今回作ったのは接続の確認のための架空の予定だけ。
- テストモードでは、カレンダーの許可が同意から7日で切れる（design.md 5節）。切れたときに「再認可待ち」と出すこと。
