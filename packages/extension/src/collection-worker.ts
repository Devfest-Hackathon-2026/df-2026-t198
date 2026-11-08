import { observationIdentity } from './auth/browser.js';
import { observationApiOrigin } from './auth/config.js';
import { syncCalendarInBackground } from './calendar/browser.js';
import { collectObservation } from './collection.js';
import { showCollectionStatus } from './collection-display.js';
import { LmsReadError, isHomePage, safeDiagnostic, type PageDiagnostic } from './collection-diagnostics.js';
import { observationSummary } from './collection-summary.js';
import { executeLmsRequest, navigation, type LmsOperation, type LmsPage } from './lms-request.js';
import { sessionFromUrl } from './session.js';
import { CollectionLease } from './collection-lease.js';
import { reusableCheckpoint, sessionHash, type CollectionCheckpoint } from './collection-checkpoint.js';
import definition from '../../../lms-definitions/coursepower/definition.json' with { type: 'json' };
import { readPage } from '../../core/src/html-reader.js';

let running = false;
let active: { sid: string; tabId: number; lease: CollectionLease } | undefined;
interface Stats { attempted: number; backgroundSucceeded: number; pageSucceeded: number; failed: number }

export async function yieldCollection(sid: string, departed: boolean): Promise<{ ok: true }> {
  if (active?.sid === sid) await active.lease.stop(departed);
  return { ok: true };
}

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
  if (running) {
    if (active?.sid === sessionFromUrl(pageUrl) && active.tabId !== tabId) await yieldCollection(active.sid, false);
    return { ok: false, code: 'busy' };
  }
  running = true;
  const fetchedAt = new Date().toISOString();
  let started = false;
  let stats: Stats | undefined;
  let route: 'background' | 'page' = 'background';
  let success = false;
  let outcome = 'incomplete';
  let lease: CollectionLease | undefined;
  let claimed = false;
  let sid: string | null = null;
  let summary: ReturnType<typeof observationSummary> | undefined;
  let recovered = 0, lmsStateErrors = 0, reusedCourses = 0;
  let checkpoint: CollectionCheckpoint | undefined;
  let loggedOut = false;
  const clearCheckpoint = () => chrome.storage.session.set({ ynuFetchCheckpoint: null });
  const countedStateErrors = new WeakSet<Error>();
  let firstFailure: (PageDiagnostic & { stage: LmsOperation['kind']; route: 'background' | 'page' }) | null = null;
  const target = { frameId: 0, ...(documentId ? { documentId } : {}) };
  const finishLease = async () => {
    const restored = await lease?.finish();
    if (active?.lease === lease) active = undefined;
    if (claimed) {
      claimed = false;
      void Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, { type: 'ynu-collection-release', sid }, target)).catch(() => {});
    }
    return restored;
  };
  const fail = (code: string) => { outcome = code; return { ok: false, code }; };
  try {
    const last = await chrome.storage.session.get(['ynuFetchCompletedAt', 'ynuFetchStatus', 'ynuFetchCheckpoint', 'ynuSessionId']);
    sid = sessionFromUrl(pageUrl);
    checkpoint = last['ynuFetchCheckpoint'] as CollectionCheckpoint | undefined;
    const hash = checkpoint && sid ? await sessionHash(sid) : '';
    if (checkpoint && (last['ynuSessionId'] !== sid || !reusableCheckpoint(checkpoint, hash, last['ynuFetchCompletedAt']))) {
      checkpoint = undefined;
      await clearCheckpoint();
    }
    const completedAt = last['ynuFetchCompletedAt'];
    if (last['ynuFetchStatus'] !== 'yielded' && typeof completedAt === 'number' && Number.isFinite(completedAt) && Date.now() - completedAt < 10 * 60_000 && Date.now() >= completedAt) {
      return { ok: false, code: 'cooldown' };
    }
    if (!sid) return fail('session-changed');
    lease = new CollectionLease(navigation.statefulSession, async () => {
      if (navigation.restore !== 'home') throw new Error('not-logged-in');
      const home = await perform({ kind: 'home' }, true);
      if (readPage(definition, home.html, { utcOffset: '+09:00' }).pageType !== 'home') throw new Error('not-logged-in');
    });
    if (navigation.statefulSession) {
      if (!isHomePage(pageUrl)) return { ok: false, code: 'not-idle' };
      // A second visible LMS tab cannot share a single server-side screen safely.
      const tabs = await chrome.tabs.query({ url: `${new URL(pageUrl).origin}/*` });
      if (tabs.length !== 1 || tabs[0]?.id !== tabId) return { ok: false, code: 'not-idle' };
      // The old home may remain visible during a slow navigation. Its recovery
      // timer requests a retry; only the browser can confirm navigation ended.
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab?.pendingUrl || tab?.status !== 'complete') return { ok: false, code: 'not-idle' };
      active = { sid, tabId, lease };
      const claim = await chrome.tabs.sendMessage(tabId, { type: 'ynu-collection-claim', sid }, target) as { ok?: boolean };
      claimed = claim?.ok === true;
      if (claim?.ok !== true || lease.stopped) return { ok: false, code: 'not-idle' };
    }
    started = true;
    await showCollectionStatus('running');
    const api = observationApiOrigin();
    if (!api) return fail('api-not-configured');
    const identity = await observationIdentity();
    if (!identity) return fail('sign-in-required');
    if (checkpoint && checkpoint.uid !== identity.uid) { checkpoint = undefined; await clearCheckpoint(); }
    checkpoint ??= { sessionHash: hash || await sessionHash(sid), uid: identity.uid, courses: [] };
    const saveCheckpoint = async () => {
      if ((await chrome.storage.session.get('ynuSessionId'))['ynuSessionId'] !== sid) return;
      if (credentialFree(JSON.stringify(checkpoint), sid!)) {
        await chrome.storage.session.set({ ynuFetchCheckpoint: checkpoint!.courses.length ? checkpoint : null }).catch(() => {});
      }
    };
    const saved = await chrome.storage.session.get(['ynuSessionId', 'ynuFetchStats']);
    if (saved['ynuSessionId'] !== sid) return fail('session-changed');
    const prior = saved['ynuFetchStats'] as Stats | undefined;
    stats = { attempted: (prior?.attempted ?? 0) + 1, backgroundSucceeded: prior?.backgroundSucceeded ?? 0,
      pageSucceeded: prior?.pageSucceeded ?? 0, failed: prior?.failed ?? 0 };
    await chrome.storage.session.set({ ynuFetchStats: stats, ynuFetchStatus: 'running' });
    let consecutivePageFailures = 0;
    const onFailure = (stage: LmsOperation['kind'], error: unknown) => {
      if (error instanceof Error && error.message === 'not-logged-in') loggedOut = true;
      if (error instanceof Error && error.message === 'lms-state' && !countedStateErrors.has(error)) {
        countedStateErrors.add(error); lmsStateErrors++;
      }
      firstFailure ??= { stage, route, ...safeDiagnostic(error instanceof LmsReadError ? error.diagnostic : undefined) };
    };
    const perform = async (operation: LmsOperation, restore = false): Promise<LmsPage> => {
      if (lease!.signal.aborted || (!restore && lease!.stopped)) throw new Error('yielded');
      if (!restore && consecutivePageFailures >= 3) throw new Error('http-error');
      if (route === 'background') {
        try {
          return await executeLmsRequest(operation, pageUrl, sid!, fetch, undefined, lease!.signal,
            () => restore || !lease!.stopped);
        } catch (error) {
          onFailure(operation.kind, error);
          // Parsing and confirmed logout belong to the reader, not transport fallback.
          if (!(error instanceof LmsReadError) || error.message !== 'http-error') throw error;
          if (lease!.signal.aborted || (!restore && lease!.stopped)) throw new Error('yielded', { cause: error });
          route = 'page';
        }
      }
      try {
        const reply = await chrome.tabs.sendMessage(tabId, { type: 'ynu-read-page', operation, sid, ...(restore ? { restore: true } : {}) },
          target) as { ok?: boolean; page?: LmsPage; code?: string; diagnostic?: PageDiagnostic };
        if (!reply?.ok || typeof reply.page?.html !== 'string' || reply.page.html.length > 5_000_000) {
          throw new LmsReadError(['not-logged-in', 'lms-state', 'yielded'].includes(reply?.code ?? '') ? reply.code! : 'http-error', safeDiagnostic(reply?.diagnostic));
        }
        const url = new URL(reply.page.url);
        if (url.origin !== 'https://lms.ynu.ac.jp' || !url.pathname.startsWith('/lms/') || url.search || url.hash || /;/.test(url.pathname)) throw new Error('http-error');
        return reply.page;
      } catch (error) {
        const failure = error instanceof LmsReadError ? error : new LmsReadError(error instanceof Error && ['not-logged-in', 'lms-state', 'yielded'].includes(error.message) ? error.message : 'http-error',
          safeDiagnostic(error instanceof LmsReadError ? error.diagnostic : undefined));
        onFailure(operation.kind, failure);
        throw failure;
      }
    };
    const request = (operation: LmsOperation) => lease!.read(() => perform(operation));
    const observation = await collectObservation({ request, observationId: crypto.randomUUID(), fetchedAt,
      onFailure, onRecovered: () => { recovered++; },
      completedCourses: checkpoint.courses, onReusedCourse: () => { reusedCourses++; },
      onCatalog: async ids => {
        checkpoint!.courses = checkpoint!.courses.filter(c => ids.includes(c.result.courseId));
        await saveCheckpoint();
      },
      onCompletedCourse: async course => {
        checkpoint!.courses.push(course);
        await saveCheckpoint();
      },
      onCourseResult: (complete, failureKind) => {
        if (route === 'page') consecutivePageFailures = !complete && failureKind === 'http' ? consecutivePageFailures + 1 : 0;
      },
    });
    summary = observationSummary(observation);
    loggedOut ||= observation.failures.some(f => f.kind === 'not-logged-in');
    const restored = await finishLease();
    if (lease.stopped) return fail('yielded');
    if (!restored) return fail('not-logged-in');
    const body = JSON.stringify(observation);
    if (!credentialFree(body, sid)) return fail('unsafe-observation');
    const current = await observationIdentity();
    if (!current || current.uid !== identity.uid) return fail('account-changed');
    if ((await chrome.storage.session.get('ynuSessionId'))['ynuSessionId'] !== sid) return fail('session-changed');
    // Once sending begins, an ambiguous response must not replay old courses with a new observation ID.
    await clearCheckpoint();
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
    await chrome.storage.session.set({ ynuFetchCompletedAt: Date.now() }).catch(() => {});
    void syncCalendarInBackground();
    success = observation.failures.length === 0;
    outcome = success ? 'success' : 'partial';
    return { ok: true, changed: receipt.changed, changeCount: receipt.changeCount };
  } catch (error) {
    if (error instanceof Error && error.message === 'lms-state') {
      if (error instanceof LmsReadError) firstFailure ??= { stage: 'home', route, ...safeDiagnostic(error.diagnostic) };
    }
    const restored = await finishLease();
    if (lease && !restored && !lease.stopped) return fail('not-logged-in');
    return fail(lease?.stopped ? 'yielded' : error instanceof Error && ['lms-state', 'not-logged-in'].includes(error.message) ? error.message : 'collection-unavailable');
  }
  finally {
    await finishLease();
    if (loggedOut || ['not-logged-in', 'session-changed', 'account-changed', 'unsafe-observation'].includes(outcome)) {
      await clearCheckpoint().catch(() => {});
    }
    if (started) {
      if (stats) {
        if (success) { if (route === 'background') stats.backgroundSucceeded++; else stats.pageSucceeded++; }
        else if (outcome !== 'yielded') stats.failed++;
      }
      await chrome.storage.session.set({ ynuFetchSummary: { ...summary,
        failures: { ...summary?.failures, ...(lmsStateErrors ? { 'lms-state': lmsStateErrors } : {}) }, firstFailure, recovered,
        yielded: outcome === 'yielded' ? 1 : 0, lmsStateErrors, reusedCourses,
        restoreSucceeded: lease?.restoreSucceeded ?? 0, restoreFailed: lease?.restoreFailed ?? 0 } }).catch(() => {});
      await chrome.storage.session.set({ ...(stats ? { ynuFetchStats: stats } : {}), ynuFetchStatus: outcome }).catch(() => {});
      await showCollectionStatus(outcome);
    }
    running = false;
  }
}
