const rows = document.getElementById("rows");
const summary = document.getElementById("summary");
const intervalSelect = document.getElementById("interval");

async function render() {
  const { log = [], intervalMinutes = 15 } = await chrome.storage.local.get(["log", "intervalMinutes"]);
  intervalSelect.value = String(intervalMinutes);
  const firstOut = log.find((e, i) => i > 0 && log[i - 1].loggedIn && !e.loggedIn);
  summary.textContent = `記録 ${log.length} 件。` +
    (firstOut ? `最初にログインが切れたのは ${new Date(firstOut.at).toLocaleString("ja-JP")}。` : "ログイン中から切れた記録はまだない。");
  rows.replaceChildren(...log.slice(-40).reverse().map((e) => {
    const tr = document.createElement("tr");
    if (!e.loggedIn) tr.className = "out";
    const state = e.error ? `失敗 ${e.error}` : `${e.loggedIn ? "取れた" : "取れない"} (${e.status})`;
    for (const text of [new Date(e.at).toLocaleString("ja-JP"), `${e.trigger}/${e.via ?? "worker"}${e.withSid ? "+SID" : ""}`, state, `${e.path ?? ""} ${e.ms ?? ""}ms`]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
}

document.getElementById("probe").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "probe-now" });
  render();
});

intervalSelect.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({ type: "set-interval", minutes: Number(intervalSelect.value) });
  render();
});

document.getElementById("copy").addEventListener("click", async () => {
  const { log = [] } = await chrome.storage.local.get("log");
  await navigator.clipboard.writeText(JSON.stringify(log, null, 1));
});

render();
