LMS製品ごとにディレクトリを作る（例：`coursepower/`、`sakai/`）。
各ディレクトリに、読み取り位置などの宣言的な定義と、個人情報を含まない試験用の見本を置く。見本は実物のページから作り、文字と番号を架空のものに置き換える。実物は `fixtures-local/`（git管理外）にだけ置く。
大学ごとのURL・表示名・時限は設定として分け、取得処理や支援の設定はここに置かない。

CoursePowerの画面移動の値は `coursepower/navigation.json`。`homePaths` は取得を始めてよいホーム、`statefulSession: true` は同じセッションで排他が必要なこと、`restore: home` は取得後にホームをGETすることを表す。`errorPage.paths` と `errorPage.markers`（selectorと含まれるtext）は、その回の取得を打ち切る画面の判別に使う。コードやSIDは定義に入れない。

状態を持たないAPIでは `statefulSession: false` を指定し、排他・操作の受け止め・復帰を使わない。PandAの取得部品は担当者の範囲なので、この修正では変更していない。
