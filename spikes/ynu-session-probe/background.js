// YNU LMSのホーム画面を取りに行き、ログインが保たれているかだけを記録する。
// 画面の中身、URLのクエリ、セッションID（pathの `;SID=...`）は保存しない。
// 比べる取り方：拡張機能の裏（worker）／開いているLMSのページの側（page）× SIDを付ける／付けない。
const HOME_URL = "https://lms.ynu.ac.jp/lms/homeHoml/doIndex";
const LOGGED_OUT_PATH = /\/(lginLgi[a-z]|logout|error)\b/;
const MAX_ENTRIES = 2000;
const DEFAULT_INTERVAL_MINUTES = 15;

function judge({ ok, status, redirected, url }) {
  const finalUrl = new URL(url);
  const path = finalUrl.pathname.split(";")[0];
  const onLoginPage = finalUrl.host !== "lms.ynu.ac.jp" || LOGGED_OUT_PATH.test(path);
  return { status, redirected, host: finalUrl.host, path, loggedIn: ok && !onLoginPage };
}

async function record(entry) {
  const { log = [] } = await chrome.storage.local.get("log");
  log.push(entry);
  await chrome.storage.local.set({ log: log.slice(-MAX_ENTRIES) });
  return entry;
}

async function probeFromWorker(trigger, sid) {
  const startedAt = Date.now();
  const withSid = Boolean(sid);
  const entry = { at: new Date().toISOString(), trigger, via: "worker", withSid };
  try {
    const response = await fetch(withSid ? `${HOME_URL};SID=${sid}` : HOME_URL, { credentials: "include", cache: "no-store" });
    await response.text();
    Object.assign(entry, judge(response));
  } catch (error) {
    Object.assign(entry, { error: String(error), loggedIn: false });
  }
  entry.ms = Date.now() - startedAt;
  return record(entry);
}

async function scheduleAlarm() {
  const { intervalMinutes = DEFAULT_INTERVAL_MINUTES } = await chrome.storage.local.get("intervalMinutes");
  await chrome.alarms.create("probe", { periodInMinutes: intervalMinutes });
}

// 同じログイン（同じSID）で何度も測らない。保存するのはSIDのハッシュだけ。
async function isNewLogin(sidHash) {
  const { lastSidHash } = await chrome.storage.local.get("lastSidHash");
  if (lastSidHash === sidHash) return false;
  await chrome.storage.local.set({ lastSidHash: sidHash, lastLoginSeenAt: new Date().toISOString() });
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
  if (message.type === "lms-login-seen") {
    isNewLogin(message.sidHash).then(async (isNew) => {
      sendResponse({ isNewLogin: isNew });
      if (!isNew) return;
      await probeFromWorker("login", null);
      await probeFromWorker("login", message.sid);
    });
    return true;
  }
  if (message.type === "page-probe-result") {
    const entry = { at: new Date().toISOString(), trigger: "login", via: "page", withSid: message.withSid, ms: message.ms };
    Object.assign(entry, message.error ? { error: message.error, loggedIn: false } : judge(message.result));
    record(entry).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "probe-now") {
    probeFromWorker("manual", null).then(sendResponse);
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
