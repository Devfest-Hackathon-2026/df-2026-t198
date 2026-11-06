# Issue #43 の実装と実機確認

## 作業計画

対象はLMSを開いたときの全授業取得、観測1件の送信、ページ側への切替。取得契約はIssue #43の再開コメント、データの契約は `docs/data-shapes.md` を使う。既存の読み取り定義と正解JSONは変更しない。

- `packages/core/src/html-navigation.ts`：既存のLinkeDOMで、許可したフォーム項目とリンク属性を読む。コードは実行しない。
- `packages/extension/src/`：固定の読み取り通信、全授業の巡回、content scriptとの通信、既存Firebase認証によるAPI送信をつなぐ。
- `packages/extension/build*.mjs`・設定の見本：同梱する読み取り定義と通信先を設定する。依存は追加しない。
- `packages/extension/tests/`：保存見本と架空のフォーム、偽fetchで巡回・切替・部分失敗・送信を検査する。秘密情報の境界は、実装前に失敗を確認する。

SID・Cookie・HTMLはAPIやログに渡さない。ページ側に渡すのは固定の読み取り操作だけで、任意のURL・メソッド・フォーム項目は受け付けない。SIDは既存のsession storageだけに保存する。授業と課題は直列で読み、通信ごとに間隔と時間制限を設ける。APIにはID tokenだけを認証ヘッダーに入れる。Googleカレンダー・クラウドのリソース・依存・共有規則は変更しない。

受入証拠は、全授業から観測1件を送る試験、裏の通信を止めても同じ読み取りをページ側で行う試験、未ログインと詳細失敗で一覧完了を偽らない試験、秘密の値・任意の通信先を拒否する試験。全体確認は依頼にある6コマンドとM1。実機の結果はSoraが確認するまで未確認とし、C04・C05を完了にしない。フォーム契約と実物が食い違う場合や、ストレージの消去・再インストールが必要な場合は停止して根拠を返す。

## Soraが行う実機確認

実際のLMSと本人の課題を扱うため、ここからはSoraが操作する。課題名・授業名・URL・画面・通信の内容はrepoやPRに貼らず、成否と件数だけを記録する。

1. 既存の拡張の設定を残したまま、`packages/extension/config.local.json` の公開設定に `apiOrigin` を加える。値は、本人が使う既存の観測APIのHTTPS origin（末尾の `/` とpathなし）。APIが未配備なら、ここで止めて配備先を確認する。この作業ではクラウドのリソースを作らない。
2. repoのルートで `pnpm --filter extension build`。Chromeの `chrome://extensions` で、すでに読み込んでいる拡張のディレクトリが、この作業ツリーの `packages/extension/dist` かを確認して再読み込みする。未導入なら「パッケージ化されていない拡張機能を読み込む」で同じディレクトリを選ぶ。別の課題の秘書が同時に有効なら、取得が重ならないように今回のものだけを有効にする。削除・再インストールやストレージの消去は行わない。
3. 設定ファイルの `firebase.projectId` と、拡張の設定画面の既存ログインのUID先頭を確認する。学生の画面と同じアカウントで接続済みであることが前提。未接続なら既存の接続テストの手順を使う（[認証の確認記録](2026-11-06-auth-probe.md)）。自動取得中に認証画面が開かないことも確認する。
4. 拡張のservice workerの検証画面で、次だけを評価する。SIDの項目やストレージ全体を表示しない。

   ```js
   await chrome.storage.session.get(['ynuFetchStats', 'ynuFetchStatus'])
   ```

5. YNUのLMSへ通常どおりログインし、LMSのページを開く。裏で通信が進む間に、ページのスクロール、授業の選択、入力途中の文字が使えることを確認する。提出ボタンは押さない。自動でタブが開いたり、ページが移動したりしないことを確認する。
6. 同じ式で結果を読む。`success` は全授業の一覧と詳細の読み取り・送信が成功、`partial` は観測は送れたが一部を読めなかった状態。`api-not-configured`・`sign-in-required` は取得前の設定待ち、`send-failed` はAPIに受理されていない状態。`running` のままなら完了と扱わない。`backgroundSucceeded` の増加と、学生画面の台帳更新を確認し、手元のLMSの一覧と取り漏れを照合する。
7. 公開終了などで詳細リンクのない教材は、一覧で見えたIDだけ残し、一覧を未完了にする。空の一覧の印は未確認なので、教材0件も成功とは判定しない。これらを `success` にするために定義や正解を変えない。

### 裏の取得を止めて確認する操作

service workerの検証画面で、次の一時的な差し替えを実行する。LMSへの裏のfetchだけを失敗させ、APIへのfetchとページ側のfetchには触れない。URLや値を出力しない。

```js
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, receiver, args) {
    const input = args[0];
    const origin = new URL(input instanceof Request ? input.url : String(input)).origin;
    if (origin === 'https://lms.ynu.ac.jp') {
      return Promise.reject(new Error('forced-background-failure'));
    }
    return Reflect.apply(target, receiver, args);
  },
});
```

LMSのページを開き直して取得を起こし、`pageSucceeded` の増加、観測の受理、学生画面の更新を確かめる。ページの操作を止めないことも繰り返し確認する。部分失敗の場合は `partial` と件数を記録する。確認後は拡張を再読み込みして一時的な差し替えを外す。

### 食い違った場合

- `linkKougi` の応答が教材表を含まず、`invokeLoad` が表を返す構成なら、その分岐が必要。今の実装は教材表を読めない回を未完了として扱う。Soraは通信のmethod・path、応答がHTMLかJSONか、フォーム項目名だけをIssueに記録する。本文・hidden値・URLのパラメーターは記録しない。実物の確認は継続し、この応答形を根拠に固定の読み取り操作を追加する。
- 認証切れは固定の `not-logged-in` として送り、ログイン画面を自動で開かない。ページの移動で元のdocumentがなくなったときは、取得できなかった分を未完了にする。
- 通信先とフォーム項目は [navigation.json](../../lms-definitions/coursepower/navigation.json)。既知の3操作以外を送れない。[Chromeの通信仕様](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)に従い、裏にはLMSと設定済みAPIのhost permissionをビルド時に付け、ページ側は同じoriginのfetchを使う。LMS内の通常のリダイレクトは追うが、最終originが違えば失敗とする。LMS自身が正しい送信先へリダイレクトすることは前提に残る。
- 授業への移動はPOSTなので、独立した参照先と確認できない授業URLは観測に加えない。課題には認証情報を除いた最終応答URLを使う。永続的な深いリンクとして使えるかは実機で確認する。
- 通信・API失敗の自動再送や、途中でworkerが止まった取得の再開は行わない。次にLMSを開いた回は新しい観測として始める。観測APIの上限は既存契約のまま。

確認結果はC04（通常取得と操作の継続）・C05（裏を止めた切替）ごとに、実施した拡張の版、成否、取得数、未確認点だけを追記の記録かIssueに残す。この結果がそろうまで両条件は `[ ]` のまま。

## 自動試験の結果

2026-11-06、このbranchで以下を実行し、すべて終了コード0。

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`：381件成功、7件スキップ。Firestore規則のエミュレーター32件を含む。通常のtestではwebの面談エミュレーター2件、serverの観測エミュレーター5件は対象外。今回のIssueは実LMSの代わりに偽fetchを使う指定であり、クラウドへの配備や実LMSへの通信はしていない。
- 拡張は66件成功。`collection-flow.test.mjs` は実際のworkerとcontent scriptを束ね、通常経路と裏のfetchを止めた経路で、それぞれ22授業・198課題から観測1件の送信とAPI側の入力検査まで確認した。通信間隔だけを短縮し、Firebase本人確認とfetchを偽物にした試験。既存HTMLは変更せず、架空のフォームと、閉じた3行の架空の詳細リンクを偽サーバーが追加した。実際の閉じた教材を読める証拠ではない。
- `collection.test.mjs` は変更していない教材見本も使用。22授業×9件の一覧IDを残し、詳細を読める6件ずつだけを課題にし、全授業を未完了にする結果を確認した。空と断定できない表、HTTP 403の認証切れ、詳細失敗も確認した。
- `collection-worker.test.ts` は二重起動の抑止、Firebase・LMSのアカウントやセッション変更、送信失敗、符号化した認証情報の送信拒否を確認した。認証情報の試験は実装前の失敗も確認した。
- `pnpm metrics:m1`：既存の比較元30/30（100%、PLAN.md、2026-11-06）に対し30/30（100%）、余分な課題0。定義・正解・測り方は変更していない。
- `pnpm progress --write`：全体15/41、必須14/37で変更なし。C04・C05は実機未確認。`check:samples` は17ファイル成功、ローカル原本は存在せず照合省略。原本の読み書きはしていない。

M4（裏の取得の成功率）・M5（画面とカレンダーまでの時間）・M7（実課題の取り漏れ）は未測定。session storageの件数は、設定とログインを確かめた後に開始した取得だけの診断用で、実際にLMSを開いた全回数に対するM4の代わりにはしない。M2・M3は別の取得部品、M6は模擬LMSの筋書きなので今回の測定対象外。

脅威の対象はLMSのSID・ページ・課題と、APIのID token。確認した境界は、送信元の拡張ID・タブ・document・現在のセッション、固定の読み取り操作、APIに渡す項目と認証情報。依存・課金・共有の認可・公開の境界は今回変更していない。手順は既存の設定画面・コード・Chromeの通信仕様と照合した。実際のフォーム、リダイレクト、入力中の画面への影響は、上の実機確認に残る。
