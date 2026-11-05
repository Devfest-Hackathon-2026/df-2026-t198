// LMSのページが開かれたことだけを裏の処理に知らせる。ページの中身は読まない。
chrome.runtime.sendMessage({ type: "lms-page-opened" });
