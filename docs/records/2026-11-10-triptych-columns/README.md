# 体験版の3列表示（Issue #291、2026-11-10）

比較元は `origin/main` の `efae2e3`。ローカルのAuth・FirestoreエミュレーターとChromiumを使い、架空の授業・課題だけを測定した。本番の確認・デプロイは行っていない。

## 変更

既存の `data-parallel='true'` を条件に、LMSの授業メニューを本文の上へ移し、表の余白・詳細の見出し列を狭い表示に合わせた。上の帯はタイトルとログイン中の表示を別の行に置く。スマホの既存規則には追加規則を適用しない。

枠上の操作も3列全体にまたがらせた。変更前はこの操作が1列を占め、LMS・学生・支援担当のうち最後の枠が次の行へ落ちていた。学生・支援担当の本文では潰れを検出しなかったため、そのCSSは変更していない。LMSの読み取りに使うDOM・セレクタ、API、依存は変更していない。

## 実測

1280・1440・1920px × 授業一覧・課題一覧・詳細の9通り。高さ1000px、動きを減らす設定で自動切り替えを止め、LMSの取得後、学生の課題と支援担当の詳細を表示した状態で測った。この版の案内併設レイアウトでは、どの幅でも各列の本文幅は274pxだった。

| 検査 | 修正前 | 修正後 |
|---|---:|---:|
| 3枠が同じ行に並ぶ | 0/9 | 9/9 |
| 本文のscrollWidth > clientWidthとなる列 | 6/27 | 0/27 |
| 本文と子要素の横はみ出し（延べ要素数） | 165 | 0 |
| 潰れを検出した表・詳細のセル | 111/120 | 0/120 |
| 幅が2文字未満で複数行になる本文要素 | 75 | 0 |
| 学生・支援担当の横はみ出し・潰れ | 0 | 0 |
| LMSのメニューが本文より上にある | 0/9 | 9/9 |

セルは左右の余白を除いた幅が「表示文字数 × 文字サイズ × 0.6」以上、または高さが2行分以内なら合格とする。詳細の締切など子要素で文字サイズが違う場合は、その表示行の行高を使う。読み取り専用の非表示・クリップ済みマーカーは表示の検査から除き、DOMには残す。横スクロール枠による例外は追加していない。

同じ試験で、既定の1画面表示（1280・1440・1920）と390pxのLMSについて、本文幅・表セル・上の帯・メニュー・本文の位置と寸法を比較し、4/4で一致した。修正前は同じ試験が失敗し、修正後は9/9・27/27で成功した。[修正前の生の測定](before.json)と[修正後](after.json)に全セルの値を残している。

## 画面写真

いずれも幅1440px、高さ1000pxのブラウザで全ページを撮影した。枠の中は縦スクロールするため、表の下側はスクロールして読む。

| LMSのページ | 修正前 | 修正後 |
|---|---|---|
| 授業一覧 | [前](before-courses-1440.png) | [後](after-courses-1440.png) |
| 課題一覧 | [前](before-assignments-1440.png) | [後](after-assignments-1440.png) |
| 課題詳細 | [前](before-detail-1440.png) | [後](after-detail-1440.png) |

6枚を目視でも確認し、修正後はタイトル、メニュー、表、3枠の並びが読めることを確認した。

## 回帰試験

[集計](regressions.json)。すべて修正後のコードで実行した。

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`：終了コード0。パッケージの単体テストはcore 274・extension 555・server 344・web 288件成功、154件スキップ。
- `judge-qa.browser.mjs`：28/28、ブラウザ例外0件。
- `demo-screen.browser.mjs`：7検査群成功。既定表示、自動・手動切り替え、動きを減らす設定、並列表示、スマホを確認。
- `mobile-layout.browser.mjs`：390・360pxの計68画面すべて成功。横はみ出し、小さい操作対象、潰れた文字、小さすぎる文字、ブラウザ例外はいずれも0件。
- 既存の体験runner全体も成功。M6は従来のローカル8/8に対し今回も8/8（模擬カレンダー）。リセット、読み取りの再送、3組6コンテキストの分離確認も成功。

途中の試験コードの不要なエスケープによるlint失敗と、同時実行によるエミュレーターのポート競合を解消し、最後は順番に実行して全チェックを通した。M1〜M5・M7は今回未測定。C33の表示・試用の回帰確認で、新しい完成条件を達成した扱いにはしていない。

## 再実行

ルートで依存を用意し、既存のPlaywrightの入口が通常のモジュール解決で見つからなければ `PLAYWRIGHT_MODULE` に指定する。エミュレーターのポートが空いている状態で、各コマンドを順番に実行する。

```sh
pnpm install --frozen-lockfile
pnpm --filter server... build
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --triptych"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-demo-browser.mjs --mobile"
pnpm exec node scripts/run-emulators.mjs --project demo-kadai-hisho --only auth,firestore "node packages/web/tests/run-plans-browser.mjs --judge-qa"
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`--triptych` の出力先はこのフォルダーで、`ARTIFACT_EVIDENCE_DIR` で変更できる。過去の記録を保存する場合は別の出力先を指定する。比較元のCSSで `TRIPTYCH_CHECK_PHASE=before` を指定すると、同じ判定で失敗しながら修正前の測定と写真を残す。修正後の実行は同じ出力先の `before.json` があれば既定表示・スマホの寸法も比較する。回帰試験は別の出力先を指定し、古い記録を上書きしない。
