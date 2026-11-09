# 録画用映像の分離と確認

PR #266、Issue #262。Soraの方針に合わせて、3人のシルエットの映像を紹介ページから外し、`/slides/story` に分離した。従来の紹介ページ側の確認は過去の `phase-2-verification.md`、今回の状態はこの記録を参照する。

## 表示と録画

- `mechanism.tsx`・`mechanism-scene.tsx`・`mechanism.css`、紹介ページの読み込みと既存試験、`scripts/record-mechanism.mjs`はorigin/mainと同じ。これらのファイルはPRの差分にない。紹介ページに映像と素材見本のリンクは出さない。映像のCSS名を分け、色トークンも単独ページだけへ適用する。
- `/slides/story?autoplay=1&sound=1` は7場面32.4秒。`&short=1` は最初の5場面25秒で、4回の時計の切り替えを含む。まとめ・ロゴは短縮版に出さない。最後で止まり、一時停止・再開・前後移動・左右キーが使える。動きを減らす設定では各場面の静止一覧。
- [両版の全12場面と操作](standalone/story-verification.json)、[UTCの同じ確認](standalone/story-utc-verification.json)。全12枚は `standalone/full-scene-*.png`・`short-scene-*.png`。1280×720で全場面の文字と操作が収まり、390pxでも16:9で縮む。APIへの通信なし・storage変更なし。素材ページの9画像と操作もブラウザで成功。
- [録画の寸法・長さ・音声](standalone/video-proof.json)。通常は `out/issue-262/story.mp4`（33.938秒）、短縮は `out/issue-262/story-short.mp4`（26.539秒）。実ファイルには冒頭と末尾の短い待ちを含む。両方1280×720・H.264＋AAC、Web Audio出力36音符を収録し、最大音量は両方-26.9 dB。MP4・中間録画はgit管理外。
- 2秒・12秒・24秒の録画フレームと、全場面の画像を開いて確認。先生の11/12→11/13、学生のLMS閲覧後のカレンダー変更、同じ締切での面談、準備と翌朝メールの順序を追える。相談室の木枠・水色液晶の時計は机の上に置かれている。[作成者による確認の記録](standalone-receipt.json)はpass。

再現はビルド済みのpreviewを使う。既存Playwrightを `PLAYWRIGHT_MODULE` に指定する。録画用Chromiumでは自動音声再生を許可している。通常のブラウザが音声の自動再生を制限する場合は、ページの「音を出す」を押す。

```sh
pnpm --filter web build
pnpm --filter web exec vite preview --host 127.0.0.1 --port 5263 --strictPort
# 別の端末
KADAI_WEB_ORIGIN=http://127.0.0.1:5263 node scripts/record-story.mjs
KADAI_WEB_ORIGIN=http://127.0.0.1:5263 node scripts/record-story.mjs --short
```

## 試験

[検査結果](standalone/checks.json)。JSTとUTCで以下がすべて終了コード0。

- 指定6検査：`pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm progress --check && pnpm check:samples`。
- 単体試験：core 274・extension 509・server 324・web 244件成功。通常の単体試験でserver 129・web 7件はskip。見本は17ファイル成功。映像8・素材15・紹介ページ5件を含む。
- 画面QA：両方28/28。M6：両方8/8（100%）、比較元は11/9 Issue #261のローカル8/8。`pnpm metrics:m6` と `pnpm test:public-demo:browser` が成功。Auth・Firestoreエミュレーターと架空データだけを使った。
- `run-landing-browser.mjs`：章の収まり、元の6段の流れ、画像・リンク・移動の試験が成功。既存の判定は変更していない。
- 最初の全体試験では色の定義を共通トークン以外へ移した点が既存試験で拒否されたため、共通トークンへ戻し適用先だけ限定して再実行した。QAの最初の起動はfirebaseがPATHになく失敗し、既存のnode_modules/.binをPATHに入れて解消した。これらの失敗は成功回に数えない。

## 進捗と残り

新しく満たしたC番号はない。C38は動画全体の提出と提出先の再生までを求めるため、この部分映像だけでは未完了。PLAN.mdに今回のM6の証拠を追記し、`pnpm progress --write`後も全体36/43・必須32/39。M1〜M5・M7は取得・解析処理を変更しないため今回の対象外。

ClaudeによるPRの確認、デモ全体への挿入と提出先での再生を残す。変更は600行を超えるため、`docs/loop.md`に沿った人の確認が必要。Issueにラベル付与の許可はなく、human:okは未付与。merge・デプロイは行わない。
