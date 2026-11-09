# Issue #262：しくみの素材見本

## 見本を開く

ローカルで `pnpm --filter web dev --port 5262` を起動し、`http://127.0.0.1:5262/slides/story-assets` を開く。紹介ページからのリンクは設けていない。

- 「素材一覧」：7種類の人物の姿勢、机・背面のノートPC、3つの部屋、3種類の時計、既存のロゴ。
- 「画面の見本」：締切の変更、面談での変化、準備の前後、カレンダー、朝のメール。
- 「3配色の比較」：同じ人物を生成りと朱色の上で並べる。
- 「場面の見本」：研究室14:00、学生の部屋21:00、相談室10:00、面談10:30、翌朝7:30。
- 「ロゴ」：ToDokuのロゴと名前。

配色と場面の選択はURLに残る。撮影用の `?capture=1` では操作欄を隠し、1280×720の画だけを表示する。例：`/slides/story-assets?capture=1&view=scene&scene=meeting&palette=a`。

## 配色と画像

色は [tokens.css](../../../packages/web/src/shared/styles/tokens.css) の `--story-teacher-a` などで管理する。Aを見本の初期値にしただけで、採用する配色は未決定。

| 案 | 先生 | 学生 | 支援担当 | 素材一覧 |
|---|---|---|---|---|
| A | 深緑 | 学生アプリと同じ青 `#2456B0` | 黄土色 | [assets-a.png](assets/assets-a.png) |
| B | 墨色 | 濃紺 | 紫 | [assets-b.png](assets/assets-b.png) |
| C | 緑 | 青緑 | 茶色 | [assets-c.png](assets/assets-c.png) |

[3案の比較](assets/palettes.png)、[画面の中身](assets/screens.png)、[ロゴ](assets/eyecatch.png)、[選択する操作欄](assets/page-controls.png)。場面は [研究室](assets/scene-office.png)、[夜の学生の部屋](assets/scene-bedroom.png)、[相談室](assets/scene-consultation.png)、[面談](assets/scene-meeting.png)、[翌朝](assets/scene-morning.png)。全12枚、各1280×720。開発版とビルド済みの画面で撮った12枚は、すべてSHA-256が一致した。

## 検証

- `pnpm install --frozen-lockfile`：成功。依存とlockfileの変更なし。
- `pnpm typecheck`・`pnpm lint`・`pnpm build`：成功。
- `pnpm progress --check`：成功。`pnpm progress --write` も実行。全体36/43・必須32/39で変化なし。素材見本だけでは新しいC番号を満たさないため、PLANのチェックは増やしていない。
- `pnpm check:samples`：17ファイル成功。実物の手元資料との比較は対象外。
- 追加の単体試験14件、紹介ページ5件、共通UIの試験8件：27件成功。
- 全体の `pnpm test`：既存の面談テスト1件が失敗。core 274件、extension 509件は成功。webは234件成功・7件skip・1件失敗。途中で止まるserverは個別に実行し、324件成功・129件skip（エミュレーター専用など）を確認。
- 素材のブラウザ試験：3配色・5場面・7姿勢、URLからの直接表示、選択と再読み込み、1280×720、文字と人物の収まり、静止表示、動きを減らす設定、API呼び出し0件、紹介ページに見本リンクがないことを確認。[操作結果と画像の一覧](assets/verification.json)。
- 同じ素材試験をビルド済みの画面でも成功。既存の `landing-chapters.browser.mjs` は1280×800・390×844の6章の収まりと静止表示が成功。既存の `landing-flow.browser.mjs` もビルド済みの画面で、両サイズの6段・約5秒ごとの進行・前後/停止/再生/キー/スワイプ・動きを減らす設定・単独16:9・通信と保存状態の維持が成功。開発中にViteの自動再読み込みで中断された実行は、この結果に含めていない。
- 保存した12枚をCodex本人が直接見て確認。独立したコードレビューではない。共有のartifact検証ツールで、ソース・試験・計画を同じ版に固定し、実行・画像の確認・最終照合が成功（run `01dcdf2ca5984d8e80c947e82c676840`）。

### 既存の面談テストの失敗

`packages/web/tests/session-page.test.tsx:275` の `prioritizes deadlines and keeps counted navigation and three context cards in both views` が `Expected: あと1日 / Received: 今日` で失敗した。

変更前のHEAD `75d40f9108ae6a60db1209898d8c843759046657` のソースを、git管理対象だけから作業ツリー外に展開し、同じテストを実行しても19件成功・同じ1件失敗となった。日付の見本は `new Date(Date.now() + 86400_000).toISOString().slice(0, 10)` でUTCの翌日を作り、表示は日本時間で判断する。実行時は日本時間の午前3時台なので、UTCの翌日が日本時間の今日になっている。この試験と面談画面は変更していない。

## 残っていること

Soraが配色と構図を選ぶ。場面の動き・時計へのズーム・切り替え・音・映像への組み込みは第2段階。merge・デプロイはしていない。既存の面談テストの日付の作り方は別の修正として扱う。
