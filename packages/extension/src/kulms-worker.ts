import type { Observation } from '../../core/src/types.js';
import { KULMS_ORIGIN } from '../../core/src/sakai-reader.js';
import { isSafeMailText } from '../../core/src/mail-safety.js';
import { observationIdentity } from './auth-probe-browser.js';
import { observationApiOrigin } from './probe-config.js';
import { syncCalendarInBackground } from './calendar-browser.js';
import { showCollectionStatus } from './collection-display.js';

let running = false;
export function isKulmsPage(url: string): boolean {
  try { return new URL(url).origin === KULMS_ORIGIN; } catch { return false; }
}
export function handleKulmsMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): boolean | undefined {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'kulms-page-ready') return undefined;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !isKulmsPage(sender.url ?? '')) {
    respond({ ok: false }); return false;
  }
  void runKulmsCollection(sender.tab.id, sender.documentId).then(respond, () => respond({ ok: false, code: 'collection-unavailable' }));
  return true;
}
async function runKulmsCollection(tabId: number, documentId?: string) {
  if (running) return { ok: false, code: 'busy' };
  running = true;
  let outcome: string | undefined;
  try {
    const saved = await chrome.storage.session.get(['kulmsFetchCompletedAt', 'kulmsFetchOwnerUid']);
    const completed = saved['kulmsFetchCompletedAt'];
    const api = observationApiOrigin();
    if (!api) { outcome = 'api-not-configured'; return { ok: false, code: outcome }; }
    const identity = await observationIdentity();
    if (!identity) { outcome = 'sign-in-required'; return { ok: false, code: outcome }; }
    if (saved['kulmsFetchOwnerUid'] === identity.uid && typeof completed === 'number' && Date.now() >= completed
      && Date.now() - completed < 600_000) return { ok: false, code: 'cooldown' };
    outcome = 'running'; await showCollectionStatus(outcome);
    const observationId = crypto.randomUUID(), fetchedAt = new Date().toISOString();
    const target = { frameId: 0, ...(documentId ? { documentId } : {}) };
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'kulms-collect', observationId, fetchedAt }, target) as {
      ok?: boolean; observation?: Observation; code?: string };
    if (!reply?.ok || !reply.observation) {
      outcome = reply?.code === 'yielded' ? 'yielded' : 'collection-unavailable';
      return { ok: false, code: outcome };
    }
    const observation = reply.observation, body = JSON.stringify(observation);
    if (observation.system !== 'kulms' || observation.schemaVersion !== 1 || observation.observationId !== observationId
      || observation.fetchedAt !== fetchedAt || !Array.isArray(observation.failures)
      || new TextEncoder().encode(body).length > 512 * 1024 || !isSafeMailText(body, [identity.token])) {
      outcome = 'unsafe-observation'; return { ok: false, code: outcome };
    }
    const current = await observationIdentity();
    if (!current || current.uid !== identity.uid) { outcome = 'account-changed'; return { ok: false, code: outcome }; }
    // Retry an ambiguous POST only with the same ID and body (receipt deduplication).
    let receipt: { status?: string; changed?: boolean; changeCount?: number } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryIdentity = await observationIdentity();
      if (!retryIdentity || retryIdentity.uid !== identity.uid) { outcome = 'account-changed'; return { ok: false, code: outcome }; }
      try {
        const response = await fetch(`${api}/api/v1/observations`, { method: 'POST', credentials: 'omit', redirect: 'error',
          referrerPolicy: 'no-referrer', headers: { Authorization: `Bearer ${retryIdentity.token}`, 'Content-Type': 'application/json' },
          body, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) { if (response.status < 500) break; continue; }
        receipt = await response.json() as typeof receipt;
        break;
      } catch { /* One bounded retry preserves the observation ID. */ }
    }
    if (receipt?.status !== 'applied' || typeof receipt.changed !== 'boolean' || !Number.isSafeInteger(receipt.changeCount)
      || receipt.changeCount! < 0 || receipt.changed !== (receipt.changeCount! > 0)) {
      outcome = 'send-failed'; return { ok: false, code: outcome };
    }
    const loggedOut = observation.failures.some(f => f.kind === 'not-logged-in');
    outcome = loggedOut ? 'not-logged-in' : observation.failures.length ? 'partial' : 'success';
    if (!observation.failures.length) await chrome.storage.session.set({ kulmsFetchCompletedAt: Date.now(), kulmsFetchOwnerUid: identity.uid });
    void syncCalendarInBackground();
    return { ok: true, changed: receipt.changed, changeCount: receipt.changeCount };
  } catch { outcome = 'collection-unavailable'; return { ok: false, code: outcome }; }
  finally {
    if (outcome) {
      await chrome.storage.session.set({ kulmsFetchStatus: outcome }).catch(() => {});
      await showCollectionStatus(outcome);
    }
    running = false;
  }
}
