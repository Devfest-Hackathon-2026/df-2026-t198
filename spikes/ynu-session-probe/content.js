// LMSのページが開かれたことを裏の処理に知らせる。
// 裏からの取得と比べるため、ページの側（同じ origin）からも1回だけ取ってみる。
// 画面には何も足さず、ページの中身も保存しない。
(async () => {
  const { probeFromPage } = await chrome.runtime.sendMessage({ type: "lms-page-opened" });
  if (!probeFromPage) return;
  const startedAt = Date.now();
  try {
    const response = await fetch("/lms/homeHoml/doIndex", { credentials: "include", cache: "no-store" });
    const body = await response.text();
    await chrome.runtime.sendMessage({
      type: "page-probe-result",
      ms: Date.now() - startedAt,
      result: {
        ok: response.ok,
        status: response.status,
        redirected: response.redirected,
        url: response.url,
        hasLogoutLink: body.includes("ログアウト"),
      },
    });
  } catch (error) {
    await chrome.runtime.sendMessage({ type: "page-probe-result", ms: Date.now() - startedAt, error: String(error) });
  }
})();
