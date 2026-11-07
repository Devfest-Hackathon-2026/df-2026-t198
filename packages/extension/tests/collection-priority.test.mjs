import { afterEach, expect, it, vi } from 'vitest';
import { fakeLms } from './helpers/stateful-lms.mjs';
import { CollectionLease } from '../src/collection-lease.js';
import { collectionDisplay } from '../src/collection-display.js';
import { protectStudentNavigation } from '../src/student-navigation.js';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

vi.mock('../src/auth-probe-browser.js', () => ({ observationIdentity: async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' }) }));
vi.mock('../src/probe-config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar-browser.js', () => ({ syncCalendarInBackground: async () => {} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const url = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';

async function fixture({ pageRoute = false, hold = false, restoreLoggedOut = false, ...options } = {}) {
  vi.resetModules();
  const f = await fakeLms({ moveStudent: false, strictState: true, ...options });
  const state = { ynuSessionId: 'synthetic-session' }, uploads = [];
  const expired = await readFile(new URL('../../../lms-definitions/coursepower/samples/session-expired.html', import.meta.url), 'utf8');
  let homeRequests = 0;
  let release, held = false;
  const read = async (url, init) => {
    if (url.includes('homeHoml/doIndex') && ++homeRequests > 1 && restoreLoggedOut) {
      return { ok: true, status: 200, url, text: async () => expired };
    }
    if (hold && !held && url.includes('linkKyozaiTitle')) {
      held = true;
      await new Promise(resolve => { release = resolve; });
    }
    return f.fetcher(url, init);
  };
  const fetcher = vi.fn(async (url, init) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) {
      if (pageRoute) throw new Error('background-blocked');
      return read(url, init);
    }
    uploads.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  const { executeLmsRequest } = await import('../src/lms-request.js');
  const pageReads = vi.fn(async (_tab, message) => {
    if (message.type !== 'ynu-read-page') return { ok: true };
    try { return { ok: true, page: await executeLmsRequest(message.operation, url, state.ynuSessionId, read, async () => {}) }; }
    catch (error) { return { ok: false, code: error.message, diagnostic: error.diagnostic }; }
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', { tabs: { query: async () => [{ id: 7 }], get: async () => ({ id: 7, status: 'complete' }), sendMessage: pageReads }, action: {}, storage: { session: {
    get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, globalThis.structuredClone(values)),
  } } });
  const realTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
    if (ms !== 250) return realTimeout(fn, ms);
    globalThis.queueMicrotask(fn); return 0;
  });
  const worker = await import('../src/collection-worker.js');
  return { ...f, state, uploads, pageReads, fetcher, worker, release: () => release(), held: () => held };
}

for (const pageRoute of [false, true]) {
  it(`yields and restores when another tab opens home with the same session (page: ${pageRoute})`, async () => {
    const f = await fixture({ pageRoute, hold: true });
    const pending = f.worker.runCollection(url, 7);
    await vi.waitFor(() => expect(f.held()).toBe(true));
    const otherTab = f.worker.runCollection(url, 8);
    f.release();
    expect(await otherTab).toEqual({ ok: false, code: 'busy' });
    expect(await pending).toEqual({ ok: false, code: 'yielded' });
    expect(f.uploads).toEqual([]);
    expect(f.state.ynuFetchSummary).toMatchObject({ yielded: 1, restoreSucceeded: 1, restoreFailed: 0 });
    expect(f.studentNavigate()).toBe(true);
    expect(f.pageReads.mock.calls.filter(([, m]) => m.type === 'ynu-read-page' && m.operation.kind === 'detail'))
      .toHaveLength(pageRoute ? 1 : 0);
    expect(f.fetcher.mock.calls.filter(([url]) => url.includes('linkKyozaiTitle'))).toHaveLength(pageRoute ? 0 : 1);
  });

  it(`restores before yielding to a student and permits an immediate fresh run (page: ${pageRoute})`, async () => {
    const f = await fixture({ pageRoute, hold: true });
    const pending = f.worker.runCollection(url, 7);
    await vi.waitFor(() => expect(f.held()).toBe(true));
    const yielding = f.worker.yieldCollection('synthetic-session', false);
    expect(f.studentNavigate()).toBe(false); // Server still has the collector's course open.
    f.release();
    await yielding;
    expect(f.studentNavigate()).toBe(true);
    expect(await pending).toEqual({ ok: false, code: 'yielded' });
    expect(f.uploads).toEqual([]);
    expect(f.state).toMatchObject({ ynuFetchStatus: 'yielded', ynuFetchStats: { failed: 0 },
      ynuFetchSummary: { yielded: 1, restoreSucceeded: 1, restoreFailed: 0 } });
    expect(f.state.ynuFetchCompletedAt).toBeUndefined();
    expect(f.fetcher.mock.calls.filter(([url]) => url.includes('linkKyozaiTitle')).length).toBe(pageRoute ? 0 : 1);
    expect(collectionDisplay(f.state.ynuCollectionDisplay).badge).toBe('');
    expect((await f.worker.runCollection(url, 7)).ok).toBe(true);
    expect(f.state.ynuFetchStatus).toBe('success');
    expect(f.state.ynuFetchStats).toMatchObject({ failed: 0, [pageRoute ? 'pageSucceeded' : 'backgroundSucceeded']: 1 });
    expect(f.studentNavigate()).toBe(true);
  });

  it(`restores after a completed collection before the student's next operation (page: ${pageRoute})`, async () => {
    const f = await fixture({ pageRoute });
    expect((await f.worker.runCollection(url, 7)).ok).toBe(true);
    expect(f.studentNavigate()).toBe(true);
    expect(f.state.ynuFetchSummary).toMatchObject({ yielded: 0, lmsStateErrors: 0, restoreSucceeded: 1 });
  });

  it(`stops at the first error screen with no retry, remaining course, or route switch (page: ${pageRoute})`, async () => {
    const f = await fixture({ pageRoute, stateError: true });
    expect(await f.worker.runCollection(url, 7)).toEqual({ ok: false, code: 'lms-state' });
    expect(f.fetcher.mock.calls.filter(([url]) => url.includes('linkKougi'))).toHaveLength(pageRoute ? 0 : 1);
    expect(f.counts().homeReads).toBe(2);
    expect(f.state.ynuFetchSummary).toMatchObject({ failures: { 'lms-state': 1 }, lmsStateErrors: 1, restoreSucceeded: 1,
      firstFailure: pageRoute ? { path: '/lms/homeHoml/doIndex', pageType: 'unknown' } : { path: '/lms/error/', pageType: 'lms-state' } });
    if (!pageRoute) expect(f.pageReads.mock.calls.filter(([, m]) => m.type === 'ynu-read-page')).toHaveLength(0);
    expect(f.uploads).toEqual([]);
    expect(f.studentNavigate()).toBe(true);
  });

  for (const stateError of [false, true]) it(`stops as logged out if restoring home fails (page: ${pageRoute}, error: ${stateError})`, async () => {
    const f = await fixture({ pageRoute, stateError, restoreLoggedOut: true });
    expect(await f.worker.runCollection(url, 7)).toEqual({ ok: false, code: 'not-logged-in' });
    expect(f.state.ynuFetchSummary).toMatchObject({ restoreSucceeded: 0, restoreFailed: 1, lmsStateErrors: stateError ? 1 : 0 });
    expect(f.uploads).toEqual([]);
  });
}

for (const [otherUrl, tabId] of [[url, 7], [url.replace('synthetic-session', 'other-synthetic-session'), 8]]) {
  it(`keeps the existing collection for ${tabId === 7 ? 'the same tab' : 'another session'}`, async () => {
    const f = await fixture({ hold: true });
    const pending = f.worker.runCollection(url, 7);
    await vi.waitFor(() => expect(f.held()).toBe(true));
    expect(await f.worker.runCollection(otherUrl, tabId)).toEqual({ ok: false, code: 'busy' });
    f.release();
    expect((await pending).ok).toBe(true);
    expect(f.uploads).toHaveLength(1);
    expect(f.state.ynuFetchSummary.yielded).toBe(0);
  });
}

it('does not restore over a page that has already navigated away', async () => {
  const f = await fixture({ hold: true });
  const pending = f.worker.runCollection(url, 7);
  await vi.waitFor(() => expect(f.held()).toBe(true));
  await f.worker.yieldCollection('synthetic-session', true);
  expect(await pending).toEqual({ ok: false, code: 'yielded' });
  f.release();
  await Promise.resolve();
  expect(f.counts().homeReads).toBe(1);
  expect(f.uploads).toEqual([]);
});

it('does not start from a course screen or when multiple LMS tabs are open', async () => {
  const f = await fixture();
  expect(await f.worker.runCollection(url.replace('homeHoml/doIndex', 'corsColl/doIndex'), 7)).toEqual({ ok: false, code: 'not-idle' });
  globalThis.chrome.tabs.query = async () => [{ id: 7 }, { id: 8 }];
  expect(await f.worker.runCollection(url, 7)).toEqual({ ok: false, code: 'not-idle' });
  expect(f.fetcher).not.toHaveBeenCalled();
});

for (const elapsed of [17_000, 32_000]) {
  for (const tab of [
    { status: 'loading', pendingUrl: 'https://lms.ynu.ac.jp/lms/studentCourse' },
    { status: 'loading' },
    { status: 'complete', pendingUrl: 'https://lms.ynu.ac.jp/lms/studentCourse' },
    {},
  ]) it(`does not claim or read a navigating/unknown tab after ${elapsed}ms: ${JSON.stringify(tab)}`, async () => {
    const f = await fixture();
    vi.useFakeTimers();
    globalThis.chrome.tabs.get = vi.fn(async () => ({ id: 7, ...tab }));
    // No successful receipt, or a yielded collection, must not mask the gate with cooldown.
    f.state.ynuFetchStatus = 'yielded';
    f.state.ynuFetchCompletedAt = Date.now();
    await vi.advanceTimersByTimeAsync(elapsed);
    const prior = globalThis.structuredClone(f.state);
    const pending = f.worker.runCollection(url, 7);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: false, code: 'not-idle' });
    expect(globalThis.chrome.tabs.get).toHaveBeenCalledExactlyOnceWith(7);
    expect(f.pageReads).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.state).toEqual(prior);
  });
}

it('does not claim or read when the tab state cannot be inspected', async () => {
  const f = await fixture();
  globalThis.chrome.tabs.get = async () => { throw new Error('tab-unavailable'); };
  expect(await f.worker.runCollection(url, 7)).toEqual({ ok: false, code: 'not-idle' });
  expect(f.pageReads).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
});

for (const pageRoute of [false, true]) it(`retries a loading tab and collects once after it completes (page: ${pageRoute})`, async () => {
  // Install the clock first so the fixture's 250ms pause bypass stays active.
  vi.useFakeTimers();
  const f = await fixture({ pageRoute });
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let releaseDigest;
  const digestGate = new Promise(resolve => { releaseDigest = resolve; });
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => {
    await digestGate;
    return digest(...args);
  });
  let status = 'loading', guard;
  const get = vi.fn(async () => ({ id: 7, status }));
  globalThis.chrome.tabs.get = get;
  const read = f.pageReads.getMockImplementation();
  f.pageReads.mockImplementation((tab, message) => {
    if (message.type === 'ynu-collection-claim') return { ok: guard.claim() };
    if (message.type === 'ynu-collection-release') { guard.release(); return { ok: true }; }
    return read(tab, message);
  });
  const collect = vi.fn(() => f.worker.runCollection(url, 7));
  guard = protectStudentNavigation({ addEventListener() {} },
    { location: { href: url }, addEventListener() {} }, async () => ({ ok: true }), collect);
  const prior = globalThis.structuredClone(f.state);
  await vi.advanceTimersByTimeAsync(4000);
  expect(collect).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(2);
  expect(f.pageReads).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.state).toEqual(prior);
  status = 'complete';
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await vi.runAllTimersAsync();
  expect(collect).toHaveBeenCalledTimes(3);
  expect(globalThis.crypto.subtle.digest).toHaveBeenCalledTimes(1);
  expect(f.fetcher).not.toHaveBeenCalled();
  // Force Web Crypto to settle after the fake queue drains, then await the collection itself.
  releaseDigest();
  await expect(collect.mock.results[2].value).resolves.toMatchObject({ ok: true });
  expect(f.state.ynuFetchStatus).toBe('success');
  expect(f.state.ynuFetchStats.attempted).toBe(1);
  expect(f.uploads).toHaveLength(1);
  expect(f.pageReads.mock.calls.filter(([, message]) => message.type === 'ynu-collection-claim')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(collect).toHaveBeenCalledTimes(3);
  expect(f.uploads).toHaveLength(1);
});

for (const previous of ['first', 'yielded']) it(`rejects recovery during a slow navigation without cooldown (${previous})`, async () => {
  const f = await fixture();
  vi.useFakeTimers();
  if (previous === 'yielded') Object.assign(f.state, { ynuFetchStatus: 'yielded', ynuFetchCompletedAt: Date.now() });
  globalThis.chrome.tabs.get = async () => ({ id: 7, status: 'loading', pendingUrl: 'https://lms.ynu.ac.jp/lms/studentCourse' });
  const events = {}, replies = [];
  protectStudentNavigation({ addEventListener() {} },
    { location: { href: url }, addEventListener: (name, fn) => { events[name] = fn; } },
    async () => ({ ok: true }), async () => { const reply = await f.worker.runCollection(url, 7); replies.push(reply); return reply; });
  events.beforeunload();
  await vi.advanceTimersByTimeAsync(17_000);
  expect(f.pageReads).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(replies).toEqual([{ ok: false, code: 'not-idle' }]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await f.worker.runCollection(url, 7)).toEqual({ ok: false, code: 'not-idle' });
  expect(f.pageReads).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
});

it('bounds a missing page reply and never restores after its deadline', async () => {
  vi.useFakeTimers();
  const restore = vi.fn();
  const lease = new CollectionLease(true, restore);
  const request = lease.read(() => new Promise(() => {}));
  const rejected = expect(request).rejects.toThrow('yielded');
  const yielding = lease.stop(false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await yielding).toBe(false);
  await rejected;
  expect(restore).not.toHaveBeenCalled();
  expect(lease.restoreFailed).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(restore).not.toHaveBeenCalled();
});

it('bounds a restoration that never responds and rejects all later reads', async () => {
  vi.useFakeTimers();
  const lease = new CollectionLease(true, () => new Promise(() => {}));
  await lease.read(async () => 'read');
  const yielding = lease.stop(false);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(await yielding).toBe(false);
  expect(lease.signal.aborted).toBe(true);
  await expect(lease.read(async () => 'must-not-run')).rejects.toThrow('yielded');
});

it('does not restore a stateless LMS session', async () => {
  const restore = vi.fn();
  const lease = new CollectionLease(false, restore);
  await lease.read(async () => 'read');
  expect(await lease.finish()).toBe(true);
  expect(restore).not.toHaveBeenCalled();
});
