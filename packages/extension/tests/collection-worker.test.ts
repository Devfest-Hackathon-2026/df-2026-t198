import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Observation } from '../../core/src/types.js';

const identity = vi.hoisted(() => vi.fn());
const collect = vi.hoisted(() => vi.fn());
const syncCalendar = vi.hoisted(() => vi.fn());
vi.mock('../src/auth-probe-browser.js', () => ({ observationIdentity: identity }));
vi.mock('../src/probe-config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar-browser.js', () => ({ syncCalendarInBackground: syncCalendar }));
vi.mock('../src/collection.js', () => ({ collectObservation: collect }));
vi.mock('../../core/src/html-reader.js', () => ({ readPage: () => ({ pageType: 'home' }) }));
const observation: Observation = { schemaVersion: 1, observationId: '00000000-0000-4000-8000-000000000001', system: 'ynu-lms',
  definitionId: 'coursepower', definitionVersion: 3, fetchedAt: '2098-11-01T00:00:00Z', catalogCourses: [], courseResults: [], assignments: [], failures: [] };
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';
const session: Record<string, unknown> = {};
const send = vi.fn();
const fetcher = vi.fn();
let run: typeof import('../src/collection-worker.js')['runCollection'];

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  for (const key of Object.keys(session)) delete session[key];
  session['ynuSessionId'] = 'synthetic-session';
  identity.mockResolvedValue({ uid: 'synthetic-user', token: 'synthetic-id-token' });
  syncCalendar.mockResolvedValue(undefined);
  collect.mockImplementation(async ({ request }) => { await request({ kind: 'home' }); return structuredClone(observation); });
  send.mockResolvedValue({ ok: true, page: { html: 'page-html', url: 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex' } });
  fetcher.mockImplementation(async (url: string) => ({ ok: true, url, status: 200, text: async () => 'worker-html',
    json: async () => ({ status: 'applied', changed: true, changeCount: 1 }) }));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', { runtime: { id: 'synthetic-extension' }, tabs: { sendMessage: send }, storage: { session: {
    get: vi.fn(async () => session), set: vi.fn(async (values) => Object.assign(session, values)),
  } } });
  run = (await import('../src/collection-worker.js')).runCollection;
});
afterEach(() => vi.unstubAllGlobals());

it('sends one observation with only the Firebase ID token and retains counts without LMS data', async () => {
  expect(await run(pageUrl, 7)).toEqual({ ok: true, changed: true, changeCount: 1 });
  const api = fetcher.mock.calls.filter(([url]) => url === 'https://api.example.test/api/v1/observations');
  expect(api).toHaveLength(1);
  expect(JSON.parse(api[0]![1].body)).toEqual(observation);
  expect(api[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer synthetic-id-token' } });
  expect(send).not.toHaveBeenCalled();
  const safeState = { ...session }; delete safeState['ynuSessionId'];
  expect(safeState).toMatchObject({ ynuFetchStats: { attempted: 1, backgroundSucceeded: 1, pageSucceeded: 0 } });
  expect(JSON.stringify(safeState)).not.toMatch(/synthetic-session|synthetic-id-token|page-html|worker-html/);
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
});
