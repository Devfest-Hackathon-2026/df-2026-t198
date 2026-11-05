// YNU LMSのホーム画面を取りに行き、ログインが保たれているかだけを記録する。
// 画面の中身・URLのクエリ（セッションIDを含む）は保存しない。
// 取り方を2つ比べる：拡張機能の裏（service worker）から取る／開いているLMSのページの側から取る。
const PROBE_URL = "https://lms.ynu.ac.jp/lms/homeHoml/doIndex";
const LOGGED_OUT_PATHS = ["/lginLgir", "/logout", "/error"];
const MAX_ENTRIES = 2000;
const DEFAULT_INTERVAL_MINUTES = 15;
const PAGE_OPEN_THROTTLE_MS = 10 * 60 * 1000;

function judge({ ok, status, redirected, url, hasLogoutLink }) {
  const finalUrl = new URL(url);
  const onLoginPage = finalUrl.host !== "lms.ynu.ac.jp" ||
    LOGGED_OUT_PATHS.some((p) => finalUrl.pathname.includes(p));
  return {
    status,
    redirected,
    host: finalUrl.host,
    path: finalUrl.pathname,
    hasLogoutLink,
    loggedIn: ok && !onLoginPage && hasLogoutLink,
  };
}

async function record(entry) {
  const { log = [] } = await chrome.storage.local.get("log");
  log.push(entry);
  await chrome.storage.local.set({ log: log.slice(-MAX_ENTRIES) });
  return entry;
}

async function probeFromWorker(trigger) {
  const startedAt = Date.now();
  const entry = { at: new Date().toISOString(), trigger, via: "worker" };
  try {
    const response = await fetch(PROBE_URL, { credentials: "include", cache: "no-store" });
    const body = await response.text();
    Object.assign(entry, judge({
      ok: response.ok,
      status: response.status,
      redirected: response.redirected,
      url: response.url,
      hasLogoutLink: body.includes("ログアウト"),
    }));
  } catch (error) {
    entry.error = String(error);
    entry.loggedIn = false;
  }
  entry.ms = Date.now() - startedAt;
  return record(entry);
}

async function getInterval() {
  const { intervalMinutes } = await chrome.storage.local.get("intervalMinutes");
  return intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
}

async function scheduleAlarm() {
  await chrome.alarms.create("probe", { periodInMinutes: await getInterval() });
}

async function shouldProbeOnPageOpen() {
  const { lastPageOpenProbeAt = 0 } = await chrome.storage.local.get("lastPageOpenProbeAt");
  if (Date.now() - lastPageOpenProbeAt < PAGE_OPEN_THROTTLE_MS) return false;
  await chrome.storage.local.set({ lastPageOpenProbeAt: Date.now() });
  return true;
}

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarm();
  await probeFromWorker("installed");
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await probeFromWorker("browser-startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "probe") probeFromWorker("alarm");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "lms-page-opened") {
    // 裏からも取り、ページの側からも取ってもらう。
    shouldProbeOnPageOpen().then((go) => {
      if (go) probeFromWorker("lms-page-opened");
      sendResponse({ probeFromPage: go });
    });
    return true;
  }
  if (message.type === "page-probe-result") {
    const entry = { at: new Date().toISOString(), trigger: "lms-page-opened", via: "page", ms: message.ms };
    if (message.error) {
      Object.assign(entry, { error: message.error, loggedIn: false });
    } else {
      Object.assign(entry, judge(message.result));
    }
    record(entry).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "probe-now") {
    probeFromWorker("manual").then(sendResponse);
    return true;
  }
  if (message.type === "set-interval") {
    chrome.storage.local.set({ intervalMinutes: message.minutes })
      .then(scheduleAlarm)
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
