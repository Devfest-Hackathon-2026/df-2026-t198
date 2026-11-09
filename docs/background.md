# 背景と既存の仕組み（2026-11-05、2026-11-06に調べた）

提出の説明資料の「解決する課題」「既存手法との違い」の材料。数字には出典を付ける。

## 対象となる学生の数

- 障害のある学生は55,510人で、全学生の1.71%（令和6年5月1日、全1,169校）。[JASSO 令和6年度調査](https://www.jasso.go.jp/statistics/gakusei_shogai_syugaku/2024.html)
- 令和7年度調査の概要では、発達障害が12,706人。発達障害・精神障害・知的障害・重複（発達と精神）を合わせると38,548人で、障害のある学生の64.9%（前年度62.0%）。[JASSO 令和7年度調査の概要](https://www.jasso.go.jp/about/press/__icsFiles/afieldfile/2026/07/30/jp2026080401.pdf)
- 2024年4月の改正障害者差別解消法の施行で、私立大学を含むすべての大学で、障害のある学生への合理的配慮の提供が法的義務になった（国公立は以前から義務）。[文部科学省の資料](https://www.mext.go.jp/content/20230517-mxt_gakushi01-000029836_1.pdf)、[JASSOのセミナー案内](https://www.jasso.go.jp/gakusei/tokubetsu_shien/event/sabetsukaisho/index.html)。支援の対象となる学生は増える傾向にあると指摘されている。

## 既存の仕組みと、この作品の違い

| 既存の仕組み | できること | 足りないこと |
|---|---|---|
| manabaの「Googleカレンダーに登録」ボタン（大学の公式機能） | 課題ごとに手で押してカレンダーに入れる | 手で押す必要がある。締切が後で変わっても予定は更新されない。[鹿児島大学の案内](https://www.kagoshima-u.ac.jp/manaba/google-manaba.pdf) |
| Comfortable PandA（京大のPandA向け、学生が開発） | PandAの課題とクイズの一覧、締切に応じた色、新しい課題の印 | PandA専用。PandAを開いたときの表示が中心で、カレンダーや支援担当にはつながらない。[論文](https://www.jstage.jst.go.jp/article/ipsjjip/32/0/32_1044/_article/-char/ja)、[ストア](https://chromewebstore.google.com/detail/comfortable-panda/cecjhdkagakhonnmddjgncmdldmppnoe) |
| UNIPA Assignment Sync（UNIPA向け） | 課題一覧のページを開くと、GoogleカレンダーとGoogleスプレッドシートに同期し、決めた時刻に知らせる | UNIPA専用。初めにスプレッドシートを自分のドライブに写す設定が要る。[ストア](https://chromeboard.com/extension/unipa-assignment-sync-fodipgpaenifggcjnbmnmkkljdkjecif) |
| MoodleWorkClawer（北海道科学大学のMoodle向け） | Moodleの課題を見つけてGoogleカレンダーに自動で入れる | 1つの大学のMoodle専用 |
| manaba-enhanced（筑波大学向け、オープンソース） | 締切までの日数で一覧を色分け | 表示の改善が中心。大学非公式と明記 |
| Assignment Manager for YNU LMS（YNUの学生が開発、MIT、最終更新2022年5月） | 講義のページを開いたときに未提出の課題をブラウザに保存し、LMSのトップに一覧を出す。Googleカレンダーへの登録のリンク | 開いた講義の課題だけ。締切の変更の追跡や支援担当へのつながりはない。[GitHub](https://github.com/Bubovirginianus/Assignment-Manager-for-YNU-LMS) |
| Comfortable Sakai（京大、Apache-2.0、Comfortable PandAの後継） | SakaiのJSONのAPI（`/direct/assignment/site/{授業ID}.json` など）で課題と小テストを取る | Sakai専用。カレンダーや支援担当にはつながらない。[GitHub](https://github.com/kyoto-u/comfortable-sakai) |

違いは3つ。

1. **1つの大学・1つの製品に閉じない。** LMSの製品ごとの定義をデータで足す形にしている（`decisions.md` のD9）。公式のAPIが無く画面のHTMLを読むCoursePower（YNU）と、JSONのAPIがあるSakai（京大のPandA）の両方を、同じ核で扱う。
2. **締切の変更を追う。** 課題の欄の変更に加え、お知らせの文章に書かれた延長や前倒しもGeminiで拾い、食い違いは「要確認」として出す。
3. **支援担当につながる。** 学生が許可した範囲で、前回の面談からの変化と次の一歩を面談画面に出す。既存の仕組みはどれも学生本人だけで完結している。

## 大学のLMSの規程について

- YNUのLMSの利用規程は、公開の検索では見つからなかった（2026-11-05）。大学の規程集か情報基盤センターで確かめる必要がある。
- この作品の拡張機能は、学生本人がふだんどおりログインしたセッションで、本人が見られるページだけを読む。YNUでは各リクエストの前に1.5秒待って1件ずつ取り、取得完了後は6時間自動で取り直さない（[D44](decisions.md#d44-ynuの取得間隔を広げ裏の取得を停止できるようにする2026-11-10issue-267)）。LMSには何も書き込まない。サーバーは学生のIDとパスワードもセッションIDも持たない。
- 同じように学生が作った拡張機能として、京大のComfortable PandA（論文として公表、NIIの催しでも発表）や、筑波大学のmanaba-enhancedがある。

## 拡張機能からカレンダーを更新するときの条件

- `chrome.identity.getAuthToken` は、Chromeのプロファイルの仕組みに頼るため、Chromeでは使えるが、EdgeやBraveでは使えないと報告されている。[Chromium Extensionsの議論](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pieiX8qKaZw)
- 代わりの `launchWebAuthFlow` は、リフレッシュトークンをサーバーに持たない場合、およそ1時間ごとにログインし直しになると報告されている。
- そのため、今回はChromeだけを対象にする。
