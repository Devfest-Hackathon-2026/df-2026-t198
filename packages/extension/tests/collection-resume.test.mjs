import { afterEach, expect, it, vi } from 'vitest';
import { fakeLms } from './helpers/stateful-lms.mjs';
import { executeLmsRequest } from '../src/lms-request.js';
import { protectStudentNavigation } from '../src/student-navigation.js';
import { parseObservation } from '../../server/src/observations/input.js';
import { URLSearchParams } from 'node:url';

vi.mock('../src/auth/browser.js', () => ({ observationIdentity: async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' }) }));
vi.mock('../src/auth/config.js', () => ({ observationApiOrigin: () => 'https://api.example.test' }));
vi.mock('../src/calendar/browser.js', () => ({ syncCalendarInBackground: async () => {} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const sid = 'synthetic-session', url = `https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=${sid}`;
const ids = [1, 2, 3, 4, 5].map(n => `KOG${String(n).padStart(13, '0')}`);
const home = courses => `<div class="weeklyCourseArea"><div class="dayBox"><div class="cpLabel">月曜日</div>${courses.map((id, i) =>
  `<div class="courseCard"><div class="courseCardInfo">第${i + 1}限<span class="term">秋学期</span></div>
  <div class="courseCardName"><a onclick="formSubmit('${id}')">架空の授業${i + 1}</a></div>
  <div class="courseCardUser">架空の教員</div></div>`).join('')}</div></div>`;

async function fixture({ pageRoute = false, ...lmsOptions } = {}) {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2098-11-01T00:00:00Z'));
  let catalog = home(ids), release, held = false, course, detail = 0;
  const f = await fakeLms({ moveStudent: false, strictState: true, transformHome: () => catalog, ...lmsOptions });
  const local = {};
  const state = { ynuSessionId: sid }, uploads = [], requests = [];
  const read = async (url, init) => {
    const fields = new URLSearchParams(init.body);
    const kind = url.includes('linkKyozaiTitle') ? 'detail' : url.includes('linkKougi') ? 'course' : 'home';
    if (kind === 'course') { course = fields.get('kougiId'); detail = 0; }
    requests.push({ kind, course });
    if (!held && course === ids[2] && kind === 'detail' && ++detail === 2) {
      held = true; await new Promise(resolve => { release = resolve; });
    }
    return f.fetcher(url, init);
  };
  const fetcher = vi.fn(async (url, init) => {
    if (url.endsWith('/api/v1/collection-policy')) return { ok: true, json: async () => ({ backgroundCollection: 'enabled' }) };
    if (url.startsWith('https://lms.ynu.ac.jp/')) {
      if (pageRoute) throw new Error('background-blocked');
      return read(url, init);
    }
    uploads.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('chrome', { action: {}, tabs: { query: async () => [{ id: 7 }], get: async () => ({ status: 'complete' }),
    sendMessage: async (_tab, message) => message.type === 'ynu-read-page'
      ? { ok: true, page: await executeLmsRequest(message.operation, url, state.ynuSessionId, read, async () => {}) } : { ok: true },
  }, storage: { local: { get: async () => globalThis.structuredClone(local), set: vi.fn(async values => Object.assign(local, values)) }, session: { get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, globalThis.structuredClone(values)) } } });
  const realTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
    if (ms !== 1500) return realTimeout(fn, ms);
    globalThis.queueMicrotask(fn); return 0;
  });
  let worker = await import('../src/collection-worker.js');
  const interrupt = async () => {
    const handlers = {}, clicked = vi.fn(() => f.studentNavigate());
    vi.stubGlobal('MouseEvent', class { constructor(type) { this.type = type; } });
    const at = Date.now(); vi.setSystemTime(at - 2000);
    const guard = protectStudentNavigation({ addEventListener: (name, fn) => { handlers[name] = fn; } },
      { location: { href: url }, addEventListener() {} }, () => worker.yieldCollection(sid, false), async () => ({ ok: true }));
    vi.setSystemTime(at); expect(guard.claim()).toBe(true);
    const pending = worker.runCollection(url, 7);
    await vi.waitFor(() => expect(held).toBe(true));
    const target = { closest() { return this; }, matches: () => false, dispatchEvent: clicked };
    handlers.click({ type: 'click', target, button: 0, cancelable: true, preventDefault() {}, stopImmediatePropagation() {} });
    expect(clicked).not.toHaveBeenCalled();
    release();
    expect(await pending).toEqual({ ok: false, code: 'yielded' });
    await vi.waitFor(() => expect(clicked).toHaveReturnedWith(true));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(uploads).toEqual([]); requests.length = 0;
  };
  return { state, uploads, requests, interrupt, run: () => worker.runCollection(url.replace(sid, state.ynuSessionId), 7),
    catalog: html => { catalog = html; }, restart: async () => { vi.resetModules(); worker = await import('../src/collection-worker.js'); } };
}

for (const pageRoute of [false, true]) it(`resumes only completed courses after yielding, including worker restart (page: ${pageRoute})`, async () => {
  const f = await fixture({ pageRoute });
  await f.interrupt();
  expect(f.state.ynuFetchCheckpoint.courses.map(c => c.result.courseId)).toEqual(ids.slice(0, 2));
  expect(JSON.stringify(f.state.ynuFetchCheckpoint)).not.toMatch(/synthetic-session|synthetic-id-token|SID=/i);
  await f.restart(); vi.setSystemTime(new Date('2098-11-01T00:01:00Z'));
  expect((await f.run()).ok).toBe(true);
  expect(f.requests.filter(r => r.kind === 'course').map(r => r.course)).toEqual(ids.slice(2));
  expect(f.requests[0].kind).toBe('home');
  const observation = f.uploads[0];
  expect(observation.courseResults.map(c => c.courseId)).toEqual(ids);
  expect(observation.courseResults.every(c => c.listComplete)).toBe(true);
  expect(observation.courseResults.every(c => c.seenSourceIds.length === 9 && c.endedSourceIds.length === 3)).toBe(true);
  expect(observation.assignments).toHaveLength(5 * 6);
  expect(new Set(observation.assignments.map(a => a.sourceId)).size).toBe(5 * 6);
  expect(observation.fetchedAt).toBe('2098-11-01T00:00:00.000Z');
  expect(parseObservation(observation)).toEqual(observation);
  expect(f.state.ynuFetchSummary).toMatchObject({ reusedCourses: 2, coursesComplete: 5 });
  expect(f.state.ynuFetchCheckpoint).toBeNull();
  expect(globalThis.chrome.storage.local.set).toHaveBeenCalledExactlyOnceWith({ 'ynuFetchCompletedAt:synthetic-user': expect.any(Number) });
});

for (const reason of ['expired', 'session', 'sent', 'account', 'clock-backward']) it(`starts from the first course when the checkpoint is ${reason}`, async () => {
  const f = await fixture(); await f.interrupt();
  if (reason === 'expired') vi.setSystemTime(new Date('2098-11-01T00:30:00.001Z'));
  if (reason === 'session') f.state.ynuSessionId = 'other-synthetic-session';
  if (reason === 'sent') f.state.ynuFetchCompletedAt = Date.now();
  if (reason === 'account') f.state.ynuFetchCheckpoint.uid = 'another-synthetic-user';
  if (reason === 'clock-backward') vi.setSystemTime(new Date('2098-10-31T23:59:59Z'));
  expect((await f.run()).ok).toBe(true);
  expect(f.requests.filter(r => r.kind === 'course').map(r => r.course)).toEqual(ids);
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(0);
});

it('reuses progress at exactly thirty minutes and clears it before starting the API send', async () => {
  const f = await fixture(); await f.interrupt();
  vi.setSystemTime(new Date('2098-11-01T00:30:00Z'));
  const fetcher = globalThis.fetch, checkpointsAtSend = [];
  vi.stubGlobal('fetch', async (url, init) => {
    if (url.endsWith('/api/v1/observations')) checkpointsAtSend.push(f.state.ynuFetchCheckpoint);
    return fetcher(url, init);
  });
  expect((await f.run()).ok).toBe(true);
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(2);
  expect(checkpointsAtSend).toEqual([null]);
  f.requests.length = 0;
  vi.setSystemTime(new Date('2098-11-01T06:30:00Z'));
  expect((await f.run()).ok).toBe(true);
  expect(f.requests.filter(r => r.kind === 'course').map(r => r.course)).toEqual(ids);
});

for (const restored of [false, true]) it(`clears cached progress on logout, including home restoration (${restored})`, async () => {
  const f = await fixture(); await f.interrupt();
  const fetcher = globalThis.fetch;
  let homes = 0;
  vi.stubGlobal('fetch', async (url, init) => {
    if (url.includes('homeHoml/doIndex') && (!restored || ++homes > 1)) {
      const { LmsReadError } = await import('../src/collection-diagnostics.js');
      throw new LmsReadError('not-logged-in');
    }
    return fetcher(url, init);
  });
  await f.run();
  expect(f.state.ynuFetchCheckpoint).toBeNull();
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(restored ? 2 : 0);
});

it('applies the credential check to the whole merged observation before upload', async () => {
  const f = await fixture(); await f.interrupt();
  f.state.ynuFetchCheckpoint.courses[0].assignments[0].title = 'Cookie%3Dsynthetic-private';
  expect(await f.run()).toEqual({ ok: false, code: 'unsafe-observation' });
  expect(f.uploads).toEqual([]);
  expect(f.state.ynuFetchCheckpoint).toBeNull();
});

it('does not reuse cached courses after an API response was lost', async () => {
  const f = await fixture(); await f.interrupt();
  const fetcher = globalThis.fetch;
  vi.stubGlobal('fetch', async (url, init) => {
    if (url.endsWith('/api/v1/observations')) throw new Error('synthetic-lost-response');
    return fetcher(url, init);
  });
  expect((await f.run()).ok).toBe(false);
  expect(f.state.ynuFetchCheckpoint).toBeNull();
  f.requests.length = 0; vi.stubGlobal('fetch', fetcher);
  expect(await f.run()).toEqual({ ok: false, code: 'cooldown' });
  expect(f.requests).toEqual([]);
  vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
  expect((await f.run()).ok).toBe(true);
  expect(f.requests.filter(r => r.kind === 'course').map(r => r.course)).toEqual(ids);
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(0);
});

it('drops all old timestamps when no cached course belongs to the new home', async () => {
  const f = await fixture(); await f.interrupt();
  f.catalog(home(ids.slice(2))); vi.setSystemTime(new Date('2098-11-01T00:01:00Z'));
  expect((await f.run()).ok).toBe(true);
  expect(f.uploads[0].fetchedAt).toBe('2098-11-01T00:01:00.000Z');
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(0);
});

it('does not cache a course whose material list could not be read completely', async () => {
  const f = await fixture({ unreadableCourses: 1 }); await f.interrupt();
  expect(f.state.ynuFetchCheckpoint.courses.map(c => c.result.courseId)).toEqual([ids[1]]);
  expect((await f.run()).ok).toBe(true);
  expect(f.requests.filter(r => r.kind === 'course').map(r => r.course)).toEqual([ids[0], ids[0], ...ids.slice(2)]);
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(1);
});

for (const pastTerm of [false, true]) it(`discards a cached course absent from the current catalog (past term: ${pastTerm})`, async () => {
  const f = await fixture(); await f.interrupt();
  f.catalog(pastTerm ? home(ids).replace('秋学期', '春学期') : home(ids.slice(1)));
  expect((await f.run()).ok).toBe(true);
  expect(f.uploads[0].courseResults.map(c => c.courseId)).toEqual(ids.slice(1));
  expect(f.uploads[0].assignments.some(a => a.courseId === ids[0])).toBe(false);
  expect(f.state.ynuFetchSummary.reusedCourses).toBe(1);
});

it('does not count pointer movement as activity during the two second idle wait', async () => {
  vi.useFakeTimers();
  const handlers = {}, collect = vi.fn(async () => ({ ok: true }));
  protectStudentNavigation({ addEventListener: (name, fn) => { handlers[name] = fn; } },
    { location: { href: url }, addEventListener() {} }, async () => ({ ok: true }), collect);
  for (let elapsed = 0; elapsed < 2000; elapsed += 100) {
    handlers.pointermove?.(); await vi.advanceTimersByTimeAsync(100);
  }
  expect(collect).toHaveBeenCalledTimes(1);
});

for (const type of ['pointerdown', 'click', 'keydown', 'input', 'scroll']) it(`continues delaying collection after ${type}`, async () => {
  vi.useFakeTimers();
  const handlers = {}, collect = vi.fn(async () => ({ ok: true }));
  protectStudentNavigation({ addEventListener: (name, fn) => { handlers[name] = fn; } },
    { location: { href: url }, addEventListener() {} }, async () => ({ ok: true }), collect);
  await vi.advanceTimersByTimeAsync(1900);
  handlers[type]({ type, target: null });
  await vi.advanceTimersByTimeAsync(1999); expect(collect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(collect).toHaveBeenCalledTimes(1);
});
