# ChatGPTで同じ案を作る

ChatGPTのデスクトップアプリでGPT-Image-2.6を使い、1案ずつ新しい会話で実行する。ここではまだChatGPTで画像を生成していない。

1. 下の表で案を選び、参照画像を保存して会話に添付する。
2. 該当する依頼文ファイルを開き、内容をすべてコピーして貼り付ける。比較ページの「この案の依頼文を読む」にも同じ文がある。
3. 画像1枚を生成する。別の案を作るときは新しい会話で、対応する依頼文と参照画像を渡す。

| 画面 | 添付する参照画像 | 貼り付ける依頼文（各1案） |
|---|---|---|
| 学生の時間割 | [student.png](references/student.png) | [A](prompts/student-a.txt) / [B](prompts/student-b.txt) / [C](prompts/student-c.txt) / [D](prompts/student-d.txt) |
| 面談画面 | [session.png](references/session.png) | [A](prompts/session-a.txt) / [B](prompts/session-b.txt) / [C](prompts/session-c.txt) / [D](prompts/session-d.txt) |

Vertex AIに送った依頼文・参照画像と同じ組み合わせ。モデルが違うため、同じ結果になるとは限らない。画像中の日本語は選定の基準にせず、配置・色・余白を比べる。生成後の採用はSoraが決める。
