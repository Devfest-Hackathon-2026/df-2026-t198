import { observationIdentity } from './auth-probe-browser.js';
import { observationApiOrigin } from './probe-config.js';
import { syncCalendarInBackground } from './calendar-browser.js';
import { collectObservation } from './collection.js';
import { showCollectionStatus } from './collection-display.js';
import { observationSummary } from './collection-summary.js';
import { executeLmsRequest, type LmsOperation, type LmsPage } from './lms-request.js';
import { readPage } from '../../core/src/html-reader.js';
import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };
import { sessionFromUrl } from './session.js';

let running = false;
interface Stats { attempted: number; backgroundSucceeded: number; pageSucceeded: number; failed: number }

function credentialFree(body: string, sid: string): boolean {
  for (let pass = 0; pass < 4; pass++) {
    if (body.includes(sid) || /\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+/i.test(body)) return false;
    const decoded = body.replace(/(?:%[\da-f]{2})+/gi, part => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    if (decoded === body) return true;
    body = decoded;
  }
  return false;
}

export async function runCollection(pageUrl: string, tabId: number, documentId?: string): Promise<{ ok: boolean; code?: string; changed?: boolean; changeCount?: number }> {
  if (running) return { ok: false, code: 'busy' };
  running = true;
  let stats: Stats | undefined;
  let route: 'background' | 'page' = 'background';
  let success = false;
  let outcome = 'incomplete';
  const fail = (code: string) => { outcome = code; return { ok: false, code }; };
  try {
    await showCollectionStatus('running');
    const api = observationApiOrigin();
    if (!api) return fail('api-not-configured');
    const identity = await observationIdentity();
    if (!identity) return fail('sign-in-required');
    const saved = await chrome.storage.session.get(['ynuSessionId', 'ynuFetchStats']);
    const sid = saved['ynuSessionId'];
    if (typeof sid !== 'string' || sessionFromUrl(pageUrl) !== sid) return fail('session-changed');
    const prior = saved['ynuFetchStats'] as Stats | undefined;
    stats = { attempted: (prior?.attempted ?? 0) + 1, backgroundSucceeded: prior?.backgroundSucceeded ?? 0,
      pageSucceeded: prior?.pageSucceeded ?? 0, failed: prior?.failed ?? 0 };
    await chrome.storage.session.set({ ynuFetchStats: stats, ynuFetchStatus: 'running' });
    let pageUnavailable = false;
    const request = async (operation: LmsOperation): Promise<LmsPage> => {
      if (pageUnavailable) throw new Error('http-error');
      if (route === 'background') {
        try {
          const page = await executeLmsRequest(operation, pageUrl, sid);
          // A 200 login/error page is also a failed background read.
          readPage(definition, page.html, { utcOffset: '+09:00', courseId: 'probe', sourceId: 'probe' });
          return page;
        } catch { route = 'page'; }
      }
      try {
        const reply = await chrome.tabs.sendMessage(tabId, { type: 'ynu-read-page', operation, sid },
          { frameId: 0, ...(documentId ? { documentId } : {}) }) as { ok?: boolean; page?: LmsPage; code?: string };
        if (!reply?.ok || typeof reply.page?.html !== 'string' || reply.page.html.length > 5_000_000) {
          throw new Error(reply?.code === 'not-logged-in' ? 'not-logged-in' : 'http-error');
        }
        const url = new URL(reply.page.url);
        if (url.origin !== 'https://lms.ynu.ac.jp' || !url.pathname.startsWith('/lms/') || url.search || url.hash || /;/.test(url.pathname)) throw new Error('http-error');
        return reply.page;
      } catch (error) {
        pageUnavailable = true;
        // eslint-disable-next-line preserve-caught-error
        throw new Error(error instanceof Error && error.message === 'not-logged-in' ? 'not-logged-in' : 'http-error');
      }
    };
    const observation = await collectObservation({ request, observationId: crypto.randomUUID(), fetchedAt: new Date().toISOString() });
    // Diagnostics only: a failed write must not change sending, syncing, or the counts.
    await chrome.storage.session.set({ ynuFetchSummary: observationSummary(observation) }).catch(() => {});
    const body = JSON.stringify(observation);
    if (!credentialFree(body, sid)) return fail('unsafe-observation');
    const current = await observationIdentity();
    if (!current || current.uid !== identity.uid) return fail('account-changed');
    if ((await chrome.storage.session.get('ynuSessionId'))['ynuSessionId'] !== sid) return fail('session-changed');
    const response = await fetch(`${api}/api/v1/observations`, { method: 'POST',
      headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' },
      body, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return fail('send-failed');
    const receipt = await response.json() as { status?: string; changed?: boolean; changeCount?: number };
    if (receipt.status !== 'applied' || typeof receipt.changed !== 'boolean'
      || typeof receipt.changeCount !== 'number' || !Number.isSafeInteger(receipt.changeCount)
      || receipt.changeCount < 0 || receipt.changed !== (receipt.changeCount > 0)) {
      return fail('send-failed');
    }
    void syncCalendarInBackground();
    success = observation.failures.length === 0;
    outcome = success ? 'success' : 'partial';
    return { ok: true, changed: receipt.changed, changeCount: receipt.changeCount };
  } catch { return fail('collection-unavailable'); }
  finally {
    if (stats) {
      if (success) { if (route === 'background') stats.backgroundSucceeded++; else stats.pageSucceeded++; }
      else stats.failed++;
    }
    await chrome.storage.session.set({ ...(stats ? { ynuFetchStats: stats } : {}), ynuFetchStatus: outcome }).catch(() => {});
    await showCollectionStatus(outcome);
    running = false;
  }
}
