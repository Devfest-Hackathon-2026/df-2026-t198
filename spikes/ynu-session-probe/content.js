// ログイン後のLMSのページが開かれたら、裏の処理に知らせる。
// YNU LMSはセッションIDをURLのpathに `;SID=...` の形で持つ。新しいSIDが現れた＝ログインした、とみなす。
// SIDはこのページの処理と裏への1回のメッセージの中だけで使い、保存しない。
const LOGGED_OUT_PATH = /\/(lginLgi[a-z]|logout|error)\b/;

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchHome(withSid, sid) {
  const startedAt = Date.now();
  const url = withSid ? `/lms/homeHoml/doIndex;SID=${sid}` : "/lms/homeHoml/doIndex";
  try {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    await response.text();
    return { withSid, ms: Date.now() - startedAt, result: { ok: response.ok, status: response.status, redirected: response.redirected, url: response.url } };
  } catch (error) {
    return { withSid, ms: Date.now() - startedAt, error: String(error) };
  }
}

(async () => {
  const match = location.pathname.match(/;SID=([^;/?#]+)/);
  if (!match || LOGGED_OUT_PATH.test(location.pathname)) return;
  const sid = match[1];
  const { isNewLogin } = await chrome.runtime.sendMessage({ type: "lms-login-seen", sidHash: await sha256(sid), sid });
  if (!isNewLogin) return;
  for (const withSid of [false, true]) {
    await chrome.runtime.sendMessage({ type: "page-probe-result", ...(await fetchHome(withSid, sid)) });
  }
})();
