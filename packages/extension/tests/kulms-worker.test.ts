import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import expected from '../../../lms-definitions/kulms/samples/observation.expected.json' with { type: 'json' };
import timetable from '../../../lms-definitions/kulasis/samples/observation.expected.json' with { type: 'json' };
import { kulasisTerm } from '../../core/src/kulasis-reader.js';
const identity = vi.hoisted(() => vi.fn());
const sync = vi.hoisted(() => vi.fn());
const display = vi.hoisted(() => vi.fn());
vi.mock('../src/auth-probe-browser.js', () => ({ observationIdentity: identity }));
vi.mock('../src/probe-config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar-browser.js', () => ({ syncCalendarInBackground: sync }));
vi.mock('../src/collection-display.js', () => ({ showCollectionStatus: display }));
let handler: typeof import('../src/kulms-worker.js').handleKulmsMessage;
let storage: Record<string, unknown>;
let local: Record<string, unknown>;
const send = vi.fn(), post = vi.fn();
const sender = { id: 'fictional-extension', frameId: 0, tab: { id: 7 }, documentId: 'fictional-doc',
  url: 'https://lms.gakusei.kyoto-u.ac.jp/portal' } as chrome.runtime.MessageSender;
const run = () => new Promise<Record<string, unknown>>(resolve => handler({ type: 'kulms-page-ready' }, sender, resolve as (x: unknown) => void));
beforeEach(async () => {
  vi.resetModules(); storage = { ynuSessionId: 'fictional-ynu-value' }; local = {};
  identity.mockReset().mockResolvedValue({ uid: 'fictional-user', token: 'fictional-api-token' });
  sync.mockReset(); display.mockReset().mockResolvedValue(undefined);
  send.mockReset().mockImplementation(async (_tab, request) => ({ ok: true, observation: { ...structuredClone(expected),
    observationId: request.observationId, fetchedAt: request.fetchedAt } }));
  post.mockReset().mockResolvedValue(new Response(JSON.stringify({ status: 'applied', changed: false, changeCount: 0 })));
  vi.stubGlobal('fetch', post);
  vi.stubGlobal('chrome', { runtime: { id: 'fictional-extension' }, tabs: { sendMessage: send },
    storage: { local: { get: async () => local, set: async (value: object) => Object.assign(local, value) }, session: { get: async () => storage, set: async (value: object) => Object.assign(storage, value) } } });
  handler = (await import('../src/kulms-worker.js')).handleKulmsMessage;
});
afterEach(() => vi.unstubAllGlobals());
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
  expect(post).not.toHaveBeenCalled(); expect(storage.kulmsFetchCompletedAt).toBeUndefined();
});
it('retries delivery with the identical observation and ID after a lost response', async () => {
  post.mockRejectedValueOnce(new Error('fictional-response-loss'));
  expect((await run()).ok).toBe(true);
  expect(post.mock.calls[0]?.[1].body).toBe(post.mock.calls[1]?.[1].body);
  expect(send).toHaveBeenCalledOnce();
});
it('sends the fixed logout failure, permits immediate retry and displays reopen guidance', async () => {
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...expected,
    observationId: request.observationId, fetchedAt: request.fetchedAt, catalogCourses: [], assignments: [], courseResults: [],
    failures: [{ courseId: null, kind: 'not-logged-in', detail: 'not-logged-in' }] } }));
  await run();
  expect(storage.kulmsFetchCompletedAt).toBeUndefined(); expect(display).toHaveBeenLastCalledWith('not-logged-in');
  post.mockResolvedValue(new Response(JSON.stringify({ status: 'applied', changed: false, changeCount: 0 })));
  expect((await run()).ok).toBe(true);
});
it('does not deliver to a changed account, including before retry', async () => {
  post.mockImplementationOnce(async () => { identity.mockResolvedValue(null); throw new Error('lost'); });
  expect((await run()).code).toBe('account-changed'); expect(post).toHaveBeenCalledOnce();
});
it('blocks credential-bearing normalized text before delivery', async () => {
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...expected,
    observationId: request.observationId, fetchedAt: request.fetchedAt, definitionId: 'cookie=fictional' } }));
  expect((await run()).code).toBe('unsafe-observation'); expect(post).not.toHaveBeenCalled();
});
it('saves the explicit timetable mapping after receipt, with a separate source status and cooldown', async () => {
  storage.kulmsFetchCompletedAt = Date.now(); storage.kulmsFetchOwnerUid = 'fictional-user';
  send.mockImplementationOnce(async (_tab, request) => ({ ok: true, observation: { ...timetable,
    observationId: request.observationId, fetchedAt: request.fetchedAt } }));
  const reply = await new Promise<Record<string, unknown>>(resolve => handler({ type: 'kulasis-page-ready' },
    { ...sender, url: 'https://www.k.kyoto-u.ac.jp/student/la/top' }, resolve as (x: unknown) => void, 'kulasis'));
  expect(reply.ok).toBe(true);
  expect(storage.kulasisFetchStatus).toBe('success'); expect(storage.kulmsFetchCompletedAt).toBe(0);
  expect(local.kulasisMapping).toEqual({ uid: 'fictional-user', term: kulasisTerm(new Date().toISOString()), siteIds: ['fictional-site'] });
  const prior = structuredClone(local);
  await run();
  expect(send.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'kulms-collect', prioritySiteIds: ['fictional-site'] });
  expect(local).toEqual(prior);
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
