import { isKulasisOrigin, kulasisTerm } from '../../core/src/kulasis-reader.js';
import type { Observation } from '../../core/src/types.js';
import { KULMS_ORIGIN } from '../../core/src/sakai-reader.js';
import { isSafeMailText } from '../../core/src/mail-safety.js';
import { observationIdentity } from './auth/browser.js';
import { observationApiOrigin } from './auth/config.js';
import { syncCalendarInBackground } from './calendar/browser.js';
import { showCollectionStatus } from './collection-display.js';

const running = new Set<string>();
export function isKulmsPage(url: string): boolean {
  try { return new URL(url).origin === KULMS_ORIGIN; } catch { return false; }
}
function isKyotoPage(system: 'kulms' | 'kulasis', value: string): boolean {
  try { const origin = new URL(value).origin; return system === 'kulms' ? origin === KULMS_ORIGIN : isKulasisOrigin(origin); }
  catch { return false; }
}
export function handleKulmsMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void, system: 'kulms' | 'kulasis' = 'kulms'): boolean | undefined {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== `${system}-page-ready`) return undefined;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !isKyotoPage(system, sender.url ?? '')) {
    respond({ ok: false }); return false;
  }
  void runKyotoCollection(system, sender.tab.id, sender.documentId).then(respond, () => respond({ ok: false, code: 'collection-unavailable' }));
  return true;
}
async function runKyotoCollection(system: 'kulms' | 'kulasis', tabId: number, documentId?: string) {
  if (running.has(system)) return { ok: false, code: 'busy' };
  running.add(system);
  let outcome: string | undefined;
  try {
    const saved = await chrome.storage.session.get([`${system}FetchCompletedAt`, `${system}FetchOwnerUid`]);
    const completed = saved[`${system}FetchCompletedAt`];
    const api = observationApiOrigin();
    if (!api) { outcome = 'api-not-configured'; return { ok: false, code: outcome }; }
    const identity = await observationIdentity();
    if (!identity) { outcome = 'sign-in-required'; return { ok: false, code: outcome }; }
    if (saved[`${system}FetchOwnerUid`] === identity.uid && typeof completed === 'number' && Date.now() >= completed
      && Date.now() - completed < 600_000) return { ok: false, code: 'cooldown' };
    outcome = 'running'; await showCollectionStatus(outcome);
    const observationId = crypto.randomUUID(), fetchedAt = new Date().toISOString();
    const cached = (await chrome.storage.local.get('kulasisMapping'))['kulasisMapping'] as { uid?: string; term?: string; siteIds?: string[] } | undefined;
    const prioritySiteIds = cached?.uid === identity.uid && cached.term === kulasisTerm(fetchedAt) && Array.isArray(cached.siteIds) ? cached.siteIds : [];
    const target = { frameId: 0, ...(documentId ? { documentId } : {}) };
    const reply = await chrome.tabs.sendMessage(tabId, { type: `${system}-collect`, observationId, fetchedAt, ...(system === 'kulms' ? { prioritySiteIds } : {}) }, target) as {
      ok?: boolean; observation?: Observation; code?: string };
    if (!reply?.ok || !reply.observation) {
      outcome = reply?.code === 'yielded' ? 'yielded' : 'collection-unavailable';
      return { ok: false, code: outcome };
    }
    const observation = reply.observation, body = JSON.stringify(observation);
    if (observation.system !== system || observation.schemaVersion !== 1 || observation.observationId !== observationId
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
    if (!observation.failures.length) {
      await chrome.storage.session.set({ [`${system}FetchCompletedAt`]: Date.now(), [`${system}FetchOwnerUid`]: identity.uid });
      if (system === 'kulasis') {
        const mapping = { uid: identity.uid, term: kulasisTerm(fetchedAt),
          siteIds: observation.catalogCourses.filter(c => c.currentTerm === true && c.kulmsSiteId).map(c => c.kulmsSiteId!) };
        await chrome.storage.local.set({ kulasisMapping: mapping });
        if (JSON.stringify(cached) !== JSON.stringify(mapping)) {
          await chrome.storage.session.set({ kulmsFetchCompletedAt: 0 });
        }
      }
    }
    void syncCalendarInBackground();
    return { ok: true, changed: receipt.changed, changeCount: receipt.changeCount };
  } catch { outcome = 'collection-unavailable'; return { ok: false, code: outcome }; }
  finally {
    if (outcome) {
      await chrome.storage.session.set({ [`${system}FetchStatus`]: outcome }).catch(() => {});
      await showCollectionStatus(outcome);
    }
    running.delete(system);
  }
}
