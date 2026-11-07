import { afterEach, expect, it, vi } from 'vitest';
import { fakeLms } from './helpers/stateful-lms.mjs';
import { safeDiagnostic } from '../src/collection-diagnostics.js';

vi.mock('../src/auth-probe-browser.js', () => ({ observationIdentity: async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' }) }));
vi.mock('../src/probe-config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar-browser.js', () => ({ syncCalendarInBackground: async () => {} }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function runFake(options, pageRoute = false) {
  vi.resetModules();
  const f = await fakeLms(options);
  const state = { ynuSessionId: 'synthetic-session' }, observations = [];
  const send = vi.fn(async (_tab, { operation }) => {
    try { return { ok: true, page: await fRequest(operation) }; }
    catch (error) { return { ok: false, code: error.message, diagnostic: error.diagnostic }; }
  });
  const { executeLmsRequest } = await import('../src/lms-request.js');
  const url = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';
  const fRequest = op => executeLmsRequest(op, url, state.ynuSessionId, f.fetcher, async () => {});
  vi.stubGlobal('chrome', { tabs: { query: async () => [{ id: 7 }], get: async () => ({ id: 7, status: 'complete' }), sendMessage: (tab, message, target) =>
    message.type === 'ynu-read-page' ? send(tab, message, target) : Promise.resolve({ ok: true }) }, action: {}, storage: { session: {
    get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, globalThis.structuredClone(values)),
  } } });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) {
      if (pageRoute) throw new Error('synthetic-blocked');
      return f.fetcher(url, init);
    }
    observations.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  }));
  // Keep all request pacing calls but advance their waits without wall-clock delay.
  const realTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
    if (ms >= 4000) return realTimeout(fn, ms);
    globalThis.queueMicrotask(fn); return 0;
  });
  const { runCollection } = await import('../src/collection-worker.js');
  const result = await runCollection(url, 7);
  return { f, state, send, result, observation: observations[0] };
}

for (const pageRoute of [false, true]) it(`recovers student navigation through the real worker (page route: ${pageRoute})`, async () => {
  const { state, observation } = await runFake({ wrongPage: true }, pageRoute);
  expect(state.ynuFetchStatus).toBe('success');
  expect(observation.assignments).toHaveLength(132);
  expect(state.ynuFetchStats).toEqual({ attempted: 1, backgroundSucceeded: pageRoute ? 0 : 1, pageSucceeded: pageRoute ? 1 : 0, failed: 0 });
  expect(state.ynuFetchSummary).toMatchObject({ recovered: 1, coursesComplete: 22,
    firstFailure: pageRoute ? { stage: 'home', route: 'background', httpStatus: null, pageType: 'unknown', path: '/lms/homeHoml/doIndex' }
      : { stage: 'course', route: 'background', httpStatus: 200, pageType: 'home', path: '/lms/homeHoml/linkKougi' } });
  expect(JSON.stringify(state.ynuFetchSummary)).not.toMatch(/KOG|REP|架空|synthetic|nendo|jyugyo|SID|Cookie/i);
});

it('stops page requests after three failed courses, rather than after the first request', async () => {
  const { f, observation, state, send } = await runFake({ permanent: true }, true);
  expect(observation.failures).toHaveLength(22);
  expect(f.fetcher.mock.calls.filter(([url]) => url.includes('linkKougi'))).toHaveLength(6);
  expect(f.counts().homeReads).toBe(5); // Includes the required final home restore.
  expect(send).toHaveBeenCalledTimes(11);
  expect(state.ynuFetchStats).toEqual({ attempted: 1, backgroundSucceeded: 0, pageSucceeded: 0, failed: 1 });
});

it('preserves the first background HTTP failure and counts successful retries on the page route', async () => {
  const { state } = await runFake({});
  expect(state.ynuFetchStatus).toBe('success');
  expect(state.ynuFetchStats).toMatchObject({ backgroundSucceeded: 0, pageSucceeded: 1 });
  expect(state.ynuFetchSummary).toMatchObject({ recovered: 1,
    firstFailure: { stage: 'course', route: 'background', httpStatus: 409, pageType: 'home', path: '/lms/homeHoml/linkKougi' } });
});

it('removes credentials, unknown page labels and IDs embedded in paths from diagnostics', () => {
  expect(safeDiagnostic({ httpStatus: 403, pageType: 'materials', path: 'https://lms.ynu.ac.jp/lms/corsColl/doIndex;SID=synthetic-secret?course=KOG2098000000001#private' }))
    .toEqual({ httpStatus: 403, pageType: 'materials', path: '/lms/corsColl/doIndex' });
  expect(safeDiagnostic({ httpStatus: 999, pageType: '架空課題 REP2098000000001', path: '/lms/corsColl/REP2098000000001' }))
    .toEqual({ httpStatus: null, pageType: 'unknown', path: null });
});


it('keeps the first detail failure while recovering both parent and detail forms', async () => {
  const { state } = await runFake({ stage: 'detail', wrongPage: true });
  expect(state.ynuFetchStatus).toBe('success');
  expect(state.ynuFetchSummary).toMatchObject({ recovered: 2, firstFailure: {
    stage: 'detail', route: 'background', httpStatus: 200, pageType: 'home', path: '/lms/corsColl/linkKyozaiTitle',
  } });
});

for (const stage of ['course', 'detail']) it(`does not switch routes or retry after ${stage} logout`, async () => {
  const { state, send, f } = await runFake({ stage, logout: true });
  expect(state.ynuFetchStatus).toBe('partial');
  expect(send).not.toHaveBeenCalled();
  expect([...f.attempts].filter(([key]) => key.startsWith(`${stage}:`))).toHaveLength(1);
  expect(f.counts().homeReads).toBe(2); // Restore also runs after logout.
  expect(state.ynuFetchSummary).toMatchObject({ recovered: 0, firstFailure: {
    stage, route: 'background', httpStatus: 403, pageType: 'unknown',
  } });
});

for (const pageRoute of [false, true]) it(`continues after four unreadable courses and two empty courses (page route: ${pageRoute})`, async () => {
  const { state, observation, f, send } = await runFake({ unreadableCourses: 4, emptyCourses: 2, moveStudent: false, redirectCourse: true }, pageRoute);
  expect(state.ynuFetchStatus).toBe('partial');
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.courseResults.filter(c => c.listComplete)).toHaveLength(18);
  expect(observation.courseResults.filter(c => c.listComplete && !c.seenSourceIds.length)).toHaveLength(2);
  expect(observation.assignments).toHaveLength(16 * 6);
  expect(observation.failures.map(f => f.kind)).toEqual(['parse', 'parse', 'parse', 'parse']);
  expect([...f.attempts].filter(([key]) => key.startsWith('course:')).map(([, n]) => n)).toEqual([...Array(4).fill(2), ...Array(18).fill(1)]);
  expect(f.counts().homeReads).toBe(6); // Four retries and a final restore.
  if (!pageRoute) {
    expect(send).not.toHaveBeenCalled();
    expect(state.ynuFetchSummary.firstFailure).toMatchObject({ stage: 'course', route: 'background', path: '/lms/homeHoml/doLinkKougi', httpStatus: 200, pageType: 'unknown' });
  }
  expect(state.ynuFetchSummary.courseFailures).toEqual(Array(4).fill({ parse: 1 }));
});

for (const pageRoute of [false, true]) it(`keeps unreadable details local without opening the page circuit (page route: ${pageRoute})`, async () => {
  const { observation, send, f } = await runFake({ unreadableDetail: true, moveStudent: false }, pageRoute);
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.courseResults.every(c => c.seenSourceIds.length === 9)).toBe(true);
  expect(observation.failures).toHaveLength(22);
  expect(observation.failures.every(f => f.kind === 'parse')).toBe(true);
  expect([...f.attempts].filter(([key]) => key.startsWith('detail:')).every(([, n]) => n === 2)).toBe(true);
  if (!pageRoute) expect(send).not.toHaveBeenCalled();
});

it('keeps only known redirect action paths in diagnostics', () => {
  for (const path of ['/lms/homeHoml/doLinkKougi', '/lms/corsColl/doLinkKyozaiTitle']) {
    expect(safeDiagnostic({ httpStatus: 200, path: `${path};SID=synthetic-secret?private=synthetic#private` }).path).toBe(path);
  }
});

for (const pageRoute of [false, true]) it(`stops on a 200 logout page without retry (page route: ${pageRoute})`, async () => {
  const { observation, state, send, f } = await runFake({ logout: true, logoutStatus: 200 }, pageRoute);
  expect(observation.courseResults).toHaveLength(1);
  expect(observation.failures.map(f => f.kind)).toEqual(['not-logged-in']);
  expect(f.counts().homeReads).toBe(2);
  expect(state.ynuFetchSummary.recovered).toBe(0);
  expect([...f.attempts].filter(([key]) => key.startsWith('course:')).map(([, n]) => n)).toEqual([1]);
  if (!pageRoute) expect(send).not.toHaveBeenCalled();
});
