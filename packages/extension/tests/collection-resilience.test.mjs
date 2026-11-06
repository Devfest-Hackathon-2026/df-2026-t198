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
  vi.stubGlobal('chrome', { tabs: { sendMessage: send }, action: {}, storage: { session: {
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
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(fn => { globalThis.queueMicrotask(fn); return 0; });
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
  expect(f.counts().homeReads).toBe(4);
  expect(send).toHaveBeenCalledTimes(10);
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
  expect(f.counts().homeReads).toBe(1);
  expect(state.ynuFetchSummary).toMatchObject({ recovered: 0, firstFailure: {
    stage, route: 'background', httpStatus: 403, pageType: 'unknown',
  } });
});
