// YNU LMSのホーム画面を定期的に取りに行き、ログインが保たれているかだけを記録する。
// 画面の中身・URLのクエリ（セッションIDを含む）は保存しない。
const PROBE_URL = "https://lms.ynu.ac.jp/lms/homeHoml/doIndex";
const LOGGED_OUT_PATHS = ["/lginLgir", "/logout", "/error"];
const MAX_ENTRIES = 2000;
const DEFAULT_INTERVAL_MINUTES = 15;

async function getInterval() {
  const { intervalMinutes } = await chrome.storage.local.get("intervalMinutes");
  return intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
}

async function scheduleAlarm() {
  const periodInMinutes = await getInterval();
  await chrome.alarms.create("probe", { periodInMinutes });
}

async function probe(trigger) {
  const entry = { at: new Date().toISOString(), trigger };
  try {
    const response = await fetch(PROBE_URL, { credentials: "include", cache: "no-store" });
    const finalUrl = new URL(response.url);
    const body = await response.text();
    entry.status = response.status;
    entry.redirected = response.redirected;
    entry.host = finalUrl.host;
    entry.path = finalUrl.pathname;
    entry.hasLogoutLink = body.includes("ログアウト");
    const onLoginPage = finalUrl.host !== "lms.ynu.ac.jp" ||
      LOGGED_OUT_PATHS.some((p) => finalUrl.pathname.includes(p));
    entry.loggedIn = response.ok && !onLoginPage && entry.hasLogoutLink;
  } catch (error) {
    entry.error = String(error);
    entry.loggedIn = false;
  }
  const { log = [] } = await chrome.storage.local.get("log");
  log.push(entry);
  await chrome.storage.local.set({ log: log.slice(-MAX_ENTRIES) });
  return entry;
}

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarm();
  await probe("installed");
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await probe("browser-startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "probe") probe("alarm");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "probe-now") {
    probe("manual").then(sendResponse);
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
