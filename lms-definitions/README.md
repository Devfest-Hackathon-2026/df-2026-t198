LMS製品ごとにディレクトリを作る（例：`coursepower/`、`sakai/`）。
各ディレクトリに、読み取り位置などの宣言的な定義と、個人情報を含まない試験用の見本を置く。見本は実物のページから作り、文字と番号を架空のものに置き換える。実物は `fixtures-local/`（git管理外）にだけ置く。
大学ごとのURL・表示名・時限は設定として分け、取得処理や支援の設定はここに置かない。

CoursePowerの画面移動の値は `coursepower/navigation.json`。`homePaths` は取得を始めてよいホーム、`statefulSession: true` は同じセッションで排他が必要なこと、`restore: home` は取得後にホームをGETすることを表す。`errorPage.paths` と `errorPage.markers`（selectorと含まれるtext）は、その回の取得を打ち切る画面の判別に使う。コードやSIDは定義に入れない。

状態を持たないAPIでは `statefulSession: false` を指定し、排他・操作の受け止め・復帰を使わない。PandAの取得部品は担当者の範囲なので、この修正では変更していない。

## 調査資料（未実装の LMS）

- KULMS（京都大学 Sakai `/direct` API）の仕様調査および現行実装との比較は [`../docs/kulms-api-comparison.md`](../docs/kulms-api-comparison.md) を参照してください（JSON 取得部品・アダプターは未実装です）。

---

## 関連調査資料: KULASIS（京都大学教務情報システム）

- **KULASIS の位置づけ**: KULASIS は LMS 本体（KULMS）ではなく、時間割・シラバス・教務連絡などの教務情報を提供する補完サービスです。現時点で `kadai-hisho` における KULASIS 向けの定義（`lms-definitions`）および読み取り部品（reader / collector）は未実装です。
- **詳細ドキュメント**: KULASIS で実際に確認した取得先・フィールド、および YNU / CoursePower・ダミー LMS・KULMS との比較については、[../docs/kulasis-data-comparison.md](../docs/kulasis-data-comparison.md) を参照してください。
