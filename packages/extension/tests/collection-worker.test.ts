import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Observation } from '../../core/src/types.js';

const apiOrigin = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => vi.fn());
const collect = vi.hoisted(() => vi.fn());
const syncCalendar = vi.hoisted(() => vi.fn());
const sync = syncCalendar;
vi.mock('../src/auth-probe-browser.js', () => ({ observationIdentity: identity }));
vi.mock('../src/probe-config.js', () => ({ observationApiOrigin: apiOrigin }));
vi.mock('../src/calendar-browser.js', () => ({ syncCalendarInBackground: syncCalendar }));
vi.mock('../src/collection.js', () => ({ collectObservation: collect }));
vi.mock('../../core/src/html-reader.js', () => ({ readPage: () => ({ pageType: 'home' }) }));
const observation: Observation = { schemaVersion: 1, observationId: '00000000-0000-4000-8000-000000000001', system: 'ynu-lms',
  definitionId: 'coursepower', definitionVersion: 3, fetchedAt: '2098-11-01T00:00:00Z', catalogCourses: [], courseResults: [], assignments: [], failures: [] };
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';
const session: Record<string, unknown> = {};
const send = vi.fn();
const fetcher = vi.fn();
const badge = vi.fn().mockResolvedValue(undefined);
const title = vi.fn().mockResolvedValue(undefined);
let run: typeof import('../src/collection-worker.js')['runCollection'];

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  apiOrigin.mockReturnValue('https://api.example.test');
  sync.mockResolvedValue(undefined);
  for (const key of Object.keys(session)) delete session[key];
  session['ynuSessionId'] = 'synthetic-session';
  identity.mockResolvedValue({ uid: 'synthetic-user', token: 'synthetic-id-token' });
  syncCalendar.mockResolvedValue(undefined);
  collect.mockImplementation(async ({ request }) => { await request({ kind: 'home' }); return structuredClone(observation); });
  send.mockResolvedValue({ ok: true, page: { html: 'page-html', url: 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex' } });
  fetcher.mockImplementation(async (url: string) => ({ ok: true, url, status: 200, text: async () => 'worker-html',
    json: async () => ({ status: 'applied', changed: true, changeCount: 1 }) }));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', { action: { setBadgeText: badge, setTitle: title, setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined) }, runtime: { id: 'synthetic-extension' }, tabs: { sendMessage: send }, storage: { session: {
    get: vi.fn(async () => session), set: vi.fn(async (values) => Object.assign(session, values)),
  } } });
  run = (await import('../src/collection-worker.js')).runCollection;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('sends one observation with only the Firebase ID token and retains counts without LMS data', async () => {
  expect(await run(pageUrl, 7)).toEqual({ ok: true, changed: true, changeCount: 1 });
  const api = fetcher.mock.calls.filter(([url]) => url === 'https://api.example.test/api/v1/observations');
  expect(api).toHaveLength(1);
  expect(JSON.parse(api[0]![1].body)).toEqual(observation);
  expect(api[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer synthetic-id-token' } });
  expect(send).not.toHaveBeenCalled();
  expect(sync).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.invocationCallOrder.at(-1)).toBeLessThan(sync.mock.invocationCallOrder[0]!);
  const safeState = { ...session }; delete safeState['ynuSessionId'];
  expect(safeState).toMatchObject({ ynuFetchStats: { attempted: 1, backgroundSucceeded: 1, pageSucceeded: 0 } });
  expect(safeState['ynuFetchSummary']).toEqual({ courses: 0, coursesComplete: 0, listed: 0, read: 0, unreadableDeadlines: 0, failures: {}, courseFailures: [], firstFailure: null, recovered: 0 });
  expect(JSON.stringify(safeState)).not.toMatch(/synthetic-session|synthetic-id-token|page-html|worker-html/);
});

it('still sends, syncs, and counts a success when saving the fetch summary fails', async () => {
  const set = vi.mocked(chrome.storage.session.set);
  set.mockImplementation(async values => {
    if ('ynuFetchSummary' in values) throw new Error('synthetic-quota');
    Object.assign(session, values);
  });
  expect(await run(pageUrl, 7)).toEqual({ ok: true, changed: true, changeCount: 1 });
  expect(fetcher.mock.calls.filter(([url]) => url === 'https://api.example.test/api/v1/observations')).toHaveLength(1);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(session).toMatchObject({ ynuFetchStatus: 'success', ynuFetchStats: { attempted: 1, backgroundSucceeded: 1, failed: 0 } });
  expect(session['ynuFetchSummary']).toBeUndefined();
});

it('uses the initiating tab for all reads when the background route fails, then sends once', async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) throw new Error('synthetic-private');
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  expect(await run(pageUrl, 7, 'synthetic-document')).toEqual({ ok: true, changed: false, changeCount: 0 });
  expect(send).toHaveBeenCalledWith(7, { type: 'ynu-read-page', operation: { kind: 'home' }, sid: 'synthetic-session' },
    { frameId: 0, documentId: 'synthetic-document' });
  expect(session).toMatchObject({ ynuFetchStats: { attempted: 1, backgroundSucceeded: 0, pageSucceeded: 1 } });
  expect(fetcher.mock.calls.filter(([url]) => url.startsWith('https://api.example.test/'))).toHaveLength(1);
});

it('serializes simultaneous triggers and does not authenticate interactively or fetch when not signed in', async () => {
  let release!: (value: null) => void;
  identity.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const pending = run(pageUrl, 7);
  expect(await run(pageUrl, 8)).toEqual({ ok: false, code: 'busy' });
  await vi.waitFor(() => expect(identity).toHaveBeenCalled());
  release(null);
  expect(await pending).toEqual({ ok: false, code: 'sign-in-required' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not send an observation if the signed-in account changed during acquisition', async () => {
  identity.mockResolvedValueOnce({ uid: 'first-user', token: 'synthetic-first-token' })
    .mockResolvedValue({ uid: 'other-user', token: 'synthetic-other-token' });
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'account-changed' });
  expect(fetcher.mock.calls.some(([url]) => url.startsWith('https://api.example.test/'))).toBe(false);
});

it.each(['SID%3Dsynthetic%2Dsession', 'Cookie%3Dsynthetic-private', '100% SID%3Dsynthetic%2Dsession'])('blocks encoded session credentials before sending: %s', async (name) => {
  collect.mockResolvedValue({ ...observation, catalogCourses: [{ courseId: 'synthetic-course', name, slots: [] }] });
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'unsafe-observation' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not reuse an observation after the LMS session changed', async () => {
  collect.mockImplementation(async () => { session['ynuSessionId'] = 'other-session'; return observation; });
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'session-changed' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('records a rejected API send without parsing or echoing the error body', async () => {
  collect.mockResolvedValue(observation);
  const json = vi.fn();
  fetcher.mockResolvedValue({ ok: false, status: 401, json });
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'send-failed' });
  expect(json).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
  expect(session['ynuFetchStatus']).toBe('send-failed');
});

it.each([
  { status: 'applied', changed: true, changeCount: -1 },
  { status: 'applied', changed: true, changeCount: 0 },
  { status: 'applied', changed: false, changeCount: 2 },
  { status: 'applied', changed: true, changeCount: 1.5 },
])('does not forward an inconsistent or invalid change receipt: %j', async receipt => {
  fetcher.mockResolvedValue({ ok: true, json: async () => receipt });
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'send-failed' });
  expect(sync).not.toHaveBeenCalled();
  expect(session['ynuFetchCompletedAt']).toBeUndefined();
});

it('keeps an accepted observation and change notice when calendar sync fails', async () => {
  sync.mockRejectedValue(new Error('synthetic-calendar-unavailable'));
  expect(await run(pageUrl, 7)).toEqual({ ok: true, changed: true, changeCount: 1 });
  expect(sync).toHaveBeenCalledTimes(1);
  expect(session['ynuFetchStatus']).toBe('success');
});

it.each([
  ['api-not-configured', '!', '課題を確かめられませんでした。拡張機能の接続先の設定が必要です'],
  ['success', '', 'LMSの課題を確かめました'],
  ['partial', '!', '一部の課題を確かめられませんでした。LMSを開き直してください'],
  ['collection-unavailable', '!', '一部の課題を確かめられませんでした。LMSを開き直してください'],
  ['send-failed', '!', '一部の課題を確かめられませんでした。LMSを開き直してください'],
  ['sign-in-required', '!', '課題を確かめられませんでした。拡張機能の設定からGoogleにログインしてください'],
  ['not-logged-in', '!', '一部の課題を確かめられませんでした。LMSを開き直してください'],
])('shows running then %s on the badge, title, and popup data', async (outcome, expectedBadge, message) => {
  if (outcome === 'api-not-configured') apiOrigin.mockReturnValue(null);
  else if (outcome === 'sign-in-required') identity.mockResolvedValue(null);
  else if (outcome === 'collection-unavailable') collect.mockRejectedValue(new Error('synthetic-private-error'));
  else if (outcome === 'send-failed') fetcher.mockResolvedValue({ ok: false });
  else if (outcome === 'partial' || outcome === 'not-logged-in') {
    collect.mockResolvedValue({ ...observation, failures: [{ courseId: null, kind: outcome === 'partial' ? 'http' : 'not-logged-in', detail: outcome === 'partial' ? 'http-error' : 'not-logged-in' }] });
  }
  await run(pageUrl, 7);
  expect(badge.mock.calls[0]).toEqual([{ text: '…' }]);
  expect(title.mock.calls[0]).toEqual([{ title: 'LMSの課題を確かめています' }]);
  expect(badge).toHaveBeenLastCalledWith({ text: expectedBadge });
  expect(title).toHaveBeenLastCalledWith({ title: expect.stringMatching(new RegExp('^\\d{1,2}/\\d{1,2} \\d{2}:\\d{2} に' + message + '$')) });
  const { collectionDisplay } = await import('../src/collection-display.js');
  expect(collectionDisplay(session['ynuCollectionDisplay']).title).toBe(title.mock.calls.at(-1)![0].title);
});

it('preserves accepted observations and diagnostic counts when presentation APIs fail', async () => {
  badge.mockRejectedValueOnce(new Error('synthetic-action-error'));
  const set = vi.mocked(chrome.storage.session.set);
  set.mockImplementation(async values => {
    if ('ynuCollectionDisplay' in values) throw new Error('synthetic-display-storage-error');
    Object.assign(session, values);
  });
  expect(await run(pageUrl, 7)).toEqual({ ok: true, changed: true, changeCount: 1 });
  expect(session).toMatchObject({ ynuFetchStatus: 'success', ynuFetchStats: { attempted: 1, backgroundSucceeded: 1, failed: 0 } });
  expect(sync).toHaveBeenCalledTimes(1);
});

it('waits ten minutes after a receipt without changing the icon, even after worker restart', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
  expect((await run(pageUrl, 7)).ok).toBe(true);
  const prior = structuredClone(session);
  vi.clearAllMocks(); vi.resetModules();
  run = (await import('../src/collection-worker.js')).runCollection;
  vi.mocked(Date.now).mockReturnValue(2_599_999);
  expect(await run(pageUrl, 7)).toEqual({ ok: false, code: 'cooldown' });
  expect(session).toEqual(prior);
  expect(badge).not.toHaveBeenCalled(); expect(title).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  vi.mocked(Date.now).mockReturnValue(2_600_000);
  expect((await run(pageUrl, 7)).ok).toBe(true);
  expect(session['ynuFetchStats']).toMatchObject({ attempted: 2, backgroundSucceeded: 2 });
});

it.each(['sign-in-required', 'api-not-configured', 'send-failed'])('allows immediate retry after %s', async code => {
  if (code === 'sign-in-required') identity.mockResolvedValue(null);
  if (code === 'api-not-configured') apiOrigin.mockReturnValue(null);
  if (code === 'send-failed') { collect.mockResolvedValue(observation); fetcher.mockResolvedValueOnce({ ok: false }); }
  expect((await run(pageUrl, 7)).code).toBe(code);
  expect(session['ynuFetchCompletedAt']).toBeUndefined();
  identity.mockResolvedValue({ uid: 'synthetic-user', token: 'synthetic-id-token' });
  apiOrigin.mockReturnValue('https://api.example.test');
  expect((await run(pageUrl, 7)).ok).toBe(true);
});

it('only opens the page circuit after three consecutive failed courses, resetting on success', async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) throw new Error('synthetic-blocked');
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  collect.mockImplementation(async ({ request, onCourseResult }) => {
    for (const complete of [false, false, true, false, false, false, false]) {
      try { await request({ kind: 'course', fields: { kougiId: 'KOG2098000000001' } }); } catch { /* Failed course. */ }
      onCourseResult(complete, complete ? undefined : 'http');
    }
    return { ...observation, failures: [{ courseId: null, kind: 'http', detail: 'http-error' }] };
  });
  send.mockRejectedValue(new Error('synthetic-page-failure'));
  expect((await run(pageUrl, 7)).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(6);
  expect(session['ynuFetchStats']).toEqual({ attempted: 1, backgroundSucceeded: 0, pageSucceeded: 0, failed: 1 });
});

it('does not fall back to the page route after confirmed logout', async () => {
  const { LmsReadError, safeDiagnostic } = await import('../src/collection-diagnostics.js');
  fetcher.mockRejectedValue(new LmsReadError('not-logged-in', safeDiagnostic()));
  // executeLmsRequest preserves the fixed logout code without exposing the error.
  expect((await run(pageUrl, 7)).ok).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it('starts the interval at receipt completion, including a partially successful collection', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  collect.mockResolvedValue({ ...observation, failures: [{ courseId: null, kind: 'http', detail: 'http-error' }] });
  fetcher.mockImplementation(async () => {
    now.mockReturnValue(1_900_000);
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  expect((await run(pageUrl, 7)).ok).toBe(true);
  expect(session['ynuFetchStatus']).toBe('partial');
  expect(session['ynuFetchCompletedAt']).toBe(1_900_000);
  now.mockReturnValue(2_499_999);
  expect((await run(pageUrl, 7)).code).toBe('cooldown');
  expect(session['ynuFetchStats']).toMatchObject({ attempted: 1, failed: 1 });
});

it('breaks the consecutive communication failure count on a parse failure', async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) throw new Error('synthetic-blocked');
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  send.mockRejectedValue(new Error('synthetic-page-failure'));
  send.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, page: { html: 'unknown', url: 'https://lms.ynu.ac.jp/lms/corsColl/doIndex' } });
  collect.mockImplementation(async ({ request, onCourseResult }) => {
    for (const kind of ['http', 'http', 'parse', 'http', 'http', 'http']) {
      try { await request({ kind: 'course', fields: { kougiId: 'KOG2098000000001' } }); } catch { /* Transport failed. */ }
      onCourseResult(false, kind);
    }
    return { ...observation, failures: [{ courseId: null, kind: 'http', detail: 'http-error' }] };
  });
  expect((await run(pageUrl, 7)).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(6);
});
