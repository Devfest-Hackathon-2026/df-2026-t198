import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import expected from '../../../lms-definitions/kulms/samples/observation.expected.json' with { type: 'json' };
import timetable from '../../../lms-definitions/kulasis/samples/observation.expected.json' with { type: 'json' };
import { kulasisTerm } from '../../core/src/kulasis-reader.js';
const identity = vi.hoisted(() => vi.fn());
const sync = vi.hoisted(() => vi.fn());
const display = vi.hoisted(() => vi.fn());
vi.mock('../src/auth/browser.js', () => ({ observationIdentity: identity }));
vi.mock('../src/auth/config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar/browser.js', () => ({ syncCalendarInBackground: sync }));
vi.mock('../src/collection-display.js', () => ({ showCollectionStatus: display }));
let handler: typeof import('../src/kulms-worker.js').handleKulmsMessage;
let storage: Record<string, unknown>;
let local: Record<string, unknown>;
const send = vi.fn(), post = vi.fn(), policy = vi.fn();
const sender = { id: 'fictional-extension', frameId: 0, tab: { id: 7 }, documentId: 'fictional-doc',
  url: 'https://lms.gakusei.kyoto-u.ac.jp/portal' } as chrome.runtime.MessageSender;
const run = () => new Promise<Record<string, unknown>>(resolve => handler({ type: 'kulms-page-ready' }, sender, resolve as (x: unknown) => void));
beforeEach(async () => {
  vi.resetModules(); storage = { ynuSessionId: 'fictional-ynu-value' }; local = {};
  identity.mockReset().mockResolvedValue({ uid: 'fictional-user', token: 'fictional-api-token' });
  sync.mockReset(); display.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockImplementation(async (_tab, request) => ({ ok: true, observation: { ...structuredClone(expected),
    observationId: request.observationId, fetchedAt: request.fetchedAt } }));
  post.mockReset().mockImplementation(async () => new Response(JSON.stringify({ status: 'applied', changed: false, changeCount: 0 })));
  policy.mockReset().mockImplementation(async () => new Response(JSON.stringify({ backgroundCollection: 'enabled' })));
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => url.endsWith('/api/v1/collection-policy') ? policy(url, init) : post(url, init));
  vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension' }, tabs: { sendMessage: send },
    storage: { local: { get: async () => local, set: async (value: object) => Object.assign(local, value) }, session: { get: async () => storage, set: async (value: object) => Object.assign(storage, value) } } });
  handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('uses the page for LMS reads, posts with isolated credentials and triggers existing calendar sync', async () => {
  expect((await run()).ok).toBe(true);
  expect(send.mock.calls[0]).toEqual([7, expect.objectContaining({ type: 'kulms-collect' }), { frameId: 0, documentId: 'fictional-doc' }]);
  expect(post).toHaveBeenCalledOnce();
  expect(post.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/observations');
  expect(post.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error', method: 'POST' });
  expect(storage.ynuSessionId).toBe('fictional-ynu-value');
  expect(storage.kulmsFetchStatus).toBe('success'); expect(sync).toHaveBeenCalledOnce();
  expect((await run()).code).toBe('cooldown');
});
it.each([{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, url: 'https://example.test/' },
  { ...sender, url: 'https://lms.ynu.ac.jp/' }, {}])('rejects a sender outside its own top KULMS document', bad => {
  const respond = vi.fn();
  expect(handler({ type: 'kulms-page-ready' }, bad, respond)).toBe(false);
  expect(respond).toHaveBeenCalledWith({ ok: false }); expect(send).not.toHaveBeenCalled();
});
it('leaves YNU message handling to the existing dispatcher', () => {
  expect(handler({ type: 'ynu-session-found' }, sender, vi.fn())).toBeUndefined();
});
it('keeps one collection running at a time', async () => {
  let finish!: (value: unknown) => void;
  send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = run();
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect((await run()).code).toBe('busy');
  finish({ ok: false, code: 'yielded' }); expect((await first).code).toBe('yielded');
  expect(post).not.toHaveBeenCalled(); expect(local['kulmsFetchCompletedAt:fictional-user']).toBeUndefined();
  expect((await run()).ok).toBe(true);
});
it('retries delivery with the identical observation and ID after a lost response', async () => {
  post.mockRejectedValueOnce(new Error('fictional-response-loss'));
  expect((await run()).ok).toBe(true);
  expect(post.mock.calls[0]?.[1].body).toBe(post.mock.calls[1]?.[1].body);
  expect(send).toHaveBeenCalledOnce();
});
it('sends the fixed logout failure, waits before retry and displays reopen guidance', async () => {
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...expected,
    observationId: request.observationId, fetchedAt: request.fetchedAt, catalogCourses: [], assignments: [], courseResults: [],
    failures: [{ courseId: null, kind: 'not-logged-in', detail: 'not-logged-in' }] } }));
  await run();
  expect(local['kulmsFetchCompletedAt:fictional-user']).toBeTypeOf('number'); expect(display).toHaveBeenLastCalledWith('not-logged-in');
  post.mockResolvedValue(new Response(JSON.stringify({ status: 'applied', changed: false, changeCount: 0 })));
  expect((await run()).code).toBe('cooldown');
});

it.each(['kulms', 'kulasis'] as const)('waits six hours after a partial %s receipt, including after worker restart', async system => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-09T00:00:00Z'));
  post.mockImplementation(async () => new Response(JSON.stringify({ status: 'applied', changed: false, changeCount: 0 })));
  const sample = system === 'kulms' ? expected : timetable;
  send.mockImplementation(async (_tab, request) => ({ ok: true, observation: { ...structuredClone(sample),
    observationId: request.observationId, fetchedAt: request.fetchedAt,
    failures: [{ courseId: null, kind: 'http', detail: 'http-error' }] } }));
  const ready = () => new Promise<Record<string, unknown>>(resolve => handler({ type: `${system}-page-ready` },
    { ...sender, url: system === 'kulms' ? sender.url! : 'https://www.k.kyoto-u.ac.jp/student/la/top' }, resolve as (value: unknown) => void, system));
  expect((await ready()).ok).toBe(true);
  expect(storage[`${system}FetchStatus`]).toBe('partial');
  storage = {};
  vi.resetModules(); handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
  vi.setSystemTime(new Date('2030-11-09T00:09:59.999Z'));
  expect((await ready()).code).toBe('cooldown');
  expect(send).toHaveBeenCalledOnce(); expect(post).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date('2030-11-09T00:10:00Z'));
  expect((await ready()).code).toBe('cooldown');
  vi.setSystemTime(new Date('2030-11-09T06:00:00Z'));
  expect((await ready()).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(2); expect(post).toHaveBeenCalledTimes(2);
});

it.each([
  ['kulms', 'send-failed'], ['kulms', 'collection-unavailable'],
  ['kulasis', 'send-failed'], ['kulasis', 'collection-unavailable'],
] as const)('also waits six hours after %s %s across browser restart', async (system, code) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-09T00:00:00Z'));
  useSample(system);
  if (code === 'send-failed') post.mockResolvedValue(new Response(null, { status: 503 }));
  else send.mockRejectedValue(new Error('fictional-transport-failure'));
  expect((await readyFor(system)).code).toBe(code);
  const posts = post.mock.calls.length;
  storage = {};
  vi.resetModules(); handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
  vi.setSystemTime(new Date('2030-11-09T05:59:59.999Z'));
  expect((await readyFor(system)).code).toBe('cooldown');
  expect(send).toHaveBeenCalledOnce(); expect(post).toHaveBeenCalledTimes(posts);
  vi.setSystemTime(new Date('2030-11-09T06:00:00Z'));
  expect((await readyFor(system)).code).toBe(code);
  expect(send).toHaveBeenCalledTimes(2);
});
it('does not deliver to a changed account, including before retry', async () => {
  post.mockImplementationOnce(async () => { identity.mockResolvedValue(null); throw new Error('lost'); });
  expect((await run()).code).toBe('account-changed'); expect(post).toHaveBeenCalledOnce();
});
it('does not apply a different owner cooldown to the signed-in student', async () => {
  storage.kulmsFetchCompletedAt = Date.now(); storage.kulmsFetchOwnerUid = 'fictional-other';
  expect((await run()).ok).toBe(true); expect(send).toHaveBeenCalledOnce();
  expect(local['kulmsFetchCompletedAt:fictional-user']).toBeTypeOf('number');
});
it('blocks credential-bearing normalized text before delivery', async () => {
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...expected,
    observationId: request.observationId, fetchedAt: request.fetchedAt, definitionId: 'cookie=fictional' } }));
  expect((await run()).code).toBe('unsafe-observation'); expect(post).not.toHaveBeenCalled();
});
it.each(['https://www.k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp'])('saves the explicit timetable mapping from %s after receipt, with a separate source status and cooldown', async origin => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-09T00:00:00Z'));
  const completed = Date.now();
  local['kulmsFetchCompletedAt:fictional-user'] = completed;
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...timetable,
    observationId: request.observationId, fetchedAt: request.fetchedAt } }));
  const reply = await new Promise<Record<string, unknown>>(resolve => handler({ type: 'kulasis-page-ready' },
    { ...sender, url: origin + '/student/la/top' }, resolve as (x: unknown) => void, 'kulasis'));
  expect(reply.ok).toBe(true);
  expect(storage.kulasisFetchStatus).toBe('success'); expect(local['kulmsFetchCompletedAt:fictional-user']).toBe(completed);
  expect(local.kulasisMapping).toEqual({ uid: 'fictional-user', term: kulasisTerm(new Date().toISOString()), siteIds: ['fictional-site'] });
  const prior = structuredClone(local.kulasisMapping);
  expect((await run()).code).toBe('cooldown');
  vi.setSystemTime(new Date('2030-11-09T06:00:00Z'));
  await run();
  expect(send.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'kulms-collect', prioritySiteIds: ['fictional-site'] });
  expect(local.kulasisMapping).toEqual(prior);
});
it.each(['another-owner', 'old-term'])('does not reuse a mapping for %s', async kind => {
  local.kulasisMapping = { uid: kind === 'another-owner' ? 'fictional-other' : 'fictional-user',
    term: kind === 'old-term' ? '1990-spring' : kulasisTerm(new Date().toISOString()), siteIds: ['fictional-site'] };
  await run(); expect(send.mock.calls[0]?.[1]).toMatchObject({ prioritySiteIds: [] });
});
it('does not replace a confirmed mapping after a failed observation delivery', async () => {
  local.kulasisMapping = { uid: 'fictional-user', siteIds: ['fictional-old'] };
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...timetable,
    observationId: request.observationId, fetchedAt: request.fetchedAt } }));
  post.mockResolvedValue(new Response(null, { status: 400 }));
  await new Promise(resolve => handler({ type: 'kulasis-page-ready' }, { ...sender, url: 'https://www.k.kyoto-u.ac.jp/student/la/top' }, resolve, 'kulasis'));
  expect(local.kulasisMapping).toEqual({ uid: 'fictional-user', siteIds: ['fictional-old'] });
});
it('keeps a confirmed mapping and the KULMS cooldown when a KULASIS mapping lookup failed', async () => {
  const completed = Date.now();
  local['kulmsFetchCompletedAt:fictional-user'] = completed;
  const mapping = { uid: 'fictional-user', term: kulasisTerm(new Date().toISOString()), siteIds: ['fictional-site'] };
  local.kulasisMapping = mapping;
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...timetable,
    observationId: request.observationId, fetchedAt: request.fetchedAt, catalogCourses: [],
    failures: [{ courseId: null, kind: 'http', detail: 'http-error' }] } }));
  await new Promise(resolve => handler({ type: 'kulasis-page-ready' }, { ...sender, url: 'https://www.k.kyoto-u.ac.jp/student/la/top' }, resolve, 'kulasis'));
  expect(local.kulasisMapping).toEqual(mapping); expect(local['kulmsFetchCompletedAt:fictional-user']).toBe(completed);
  expect(storage.kulasisFetchStatus).toBe('partial');
});

const readyFor = (system: 'kulms' | 'kulasis') => new Promise<Record<string, unknown>>(resolve => handler(
  { type: `${system}-page-ready` },
  { ...sender, url: system === 'kulms' ? sender.url! : 'https://www.k.kyoto-u.ac.jp/student/la/top' },
  resolve as (value: unknown) => void, system));
function useSample(system: 'kulms' | 'kulasis') {
  send.mockImplementation(async (_tab, request) => ({ ok: true, observation: {
    ...structuredClone(system === 'kulms' ? expected : timetable),
    observationId: request.observationId, fetchedAt: request.fetchedAt,
  } }));
}
it.each(['kulms', 'kulasis'] as const)('keeps the %s six-hour wait after clearing session storage and restarting the browser worker', async system => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-09T00:00:00Z'));
  useSample(system);
  expect((await readyFor(system)).ok).toBe(true);
  storage = {};
  vi.resetModules(); handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
  vi.setSystemTime(new Date('2030-11-09T05:59:59.999Z'));
  expect((await readyFor(system)).code).toBe('cooldown');
  expect(send).toHaveBeenCalledOnce(); expect(policy).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date('2030-11-09T06:00:00Z'));
  expect((await readyFor(system)).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(2); expect(policy).toHaveBeenCalledTimes(2);
});
it.each(['kulms', 'kulasis'] as const)('keeps each %s owner wait when students switch accounts and switch back', async system => {
  useSample(system);
  expect((await readyFor(system)).ok).toBe(true);
  identity.mockResolvedValue({ uid: 'fictional-other', token: 'fictional-other-token' });
  expect((await readyFor(system)).ok).toBe(true);
  identity.mockResolvedValue({ uid: 'fictional-user', token: 'fictional-api-token' });
  expect((await readyFor(system)).code).toBe('cooldown');
  expect(send).toHaveBeenCalledTimes(2);
});
it.each(['kulms', 'kulasis'] as const)('blocks all %s page reads while paused or policy is unreadable, and permits a later enabled check', async system => {
  useSample(system);
  for (const reply of [
    () => new Response('{"backgroundCollection":"paused"}'),
    () => new Response('{"backgroundCollection":"enabled"}', { status: 503 }),
    () => new Response('not-json'),
    () => new Response('{}'),
    () => new Response('null'),
    () => new Response('{"backgroundCollection":true}'),
    () => new Response('{"backgroundCollection":"unknown"}'),
    () => Promise.reject(new Error('fictional-timeout')),
  ]) {
    policy.mockImplementationOnce(reply);
    expect((await readyFor(system)).ok).toBe(false);
    expect(send).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  }
  expect((await readyFor(system)).ok).toBe(true);
  expect(send).toHaveBeenCalledOnce();
  expect(policy.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/collection-policy');
  expect(policy.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store',
    redirect: 'error', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal) });
});
it('does not bypass the KULMS wait when a successful KULASIS mapping changes', async () => {
  expect((await run()).ok).toBe(true);
  useSample('kulasis');
  expect((await readyFor('kulasis')).ok).toBe(true);
  expect((await run()).code).toBe('cooldown');
  expect(send).toHaveBeenCalledTimes(2);
});
it.each(['kulms', 'kulasis'] as const)('carries a legacy %s session completion into local storage before browser restart', async system => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-11-09T00:00:00Z'));
  storage[`${system}FetchCompletedAt`] = Date.now(); storage[`${system}FetchOwnerUid`] = 'fictional-user';
  expect((await readyFor(system)).code).toBe('cooldown');
  storage = {};
  vi.resetModules(); handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
  vi.setSystemTime(new Date('2030-11-09T05:59:59.999Z'));
  expect((await readyFor(system)).code).toBe('cooldown');
  expect(send).not.toHaveBeenCalled(); expect(policy).not.toHaveBeenCalled();
});
