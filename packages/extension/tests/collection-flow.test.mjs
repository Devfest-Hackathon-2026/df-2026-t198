import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { expect, it, vi } from 'vitest';
import { setTimeout, clearTimeout, setImmediate } from 'node:timers';
import { parseObservation } from '../../server/src/observations/input.js';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { applyObservation } from '../../core/src/ledger.js';
import { acknowledgeCalendarItem, reconcileCalendarItem } from '../../core/src/calendar.js';

const { parseHTML } = createRequire(new URL('../../core/package.json', import.meta.url))('linkedom');

const config = { apiOrigin: 'https://api.example.test', oauthClientId: '123-synthetic.apps.googleusercontent.com',
  firebase: { apiKey: 'synthetic-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' } };
const worker = await build({
  entryPoints: [fileURLToPath(new URL('../src/service-worker.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  plugins: [{ name: 'fake-identity', setup(builder) {
    builder.onResolve({ filter: /(?:auth\/|^\.\/)browser\.js$/ }, () => ({ path: 'identity', namespace: 'fake' }));
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
      export const observationIdentity = async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' });
      export const firebaseAuth = () => sdk.auth;
      export const readProbeState = async () => sdk.probe;
      export const confirmGoogleIdentity = async (token, uid) => token === 'synthetic-google-token' && uid === 'synthetic-user';
      export const browserProbe = () => { throw new Error('interactive-auth-forbidden'); };` }));
  } }],
});
const content = await build({ entryPoints: [fileURLToPath(new URL('../src/content.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) } });
const samples = new URL('../../../lms-definitions/coursepower/samples/', import.meta.url);
const home = await readFile(new URL('home.html', samples), 'utf8');
const materials = await readFile(new URL('assignment-list.html', samples), 'utf8');
const detail = await readFile(new URL('assignment-detail-open.html', samples), 'utf8');
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';

for (const backgroundBlocked of [false, true]) for (const connected of [false, true]) it(`LMS open creates and moves deadline events (background blocked: ${backgroundBlocked}, calendar connected: ${connected})`, async () => {
  const state = {};
  const apiBodies = [], backgroundCalls = [], pageCalls = [];
  const calendarId = 'synthetic@group.calendar.google.com';
  const sdk = { auth: { authStateReady: async () => {}, currentUser: {
    uid: 'synthetic-user', getIdToken: async () => 'synthetic-id-token',
  } }, probe: connected ? { uid: 'synthetic-user', namespace: `${config.firebase.projectId}:${config.oauthClientId}`,
    calendar: { status: 'ready', id: calendarId } } : undefined };
  const items = new Map(), events = new Map(), googleCalls = [], reports = [];
  let ledger = [], changes = [], extended = false, ended = false;
  const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => globalThis.structuredClone(data) });
  let workerListener, contentListener, trigger;
  // Existing sample data stays untouched. The fake server adds synthetic forms and
  // open availability and accessible links for all rows to exercise creation/move.
  const lmsFetch = (calls) => vi.fn(async (url, init) => {
    calls.push({ url, init });
    const fields = new URLSearchParams(String(init.body ?? ''));
    let list = materials.replaceAll('公開終了', '公開中').replace(/(<td class="kyozaititleCell" id="(REP\d+)">)([\s\S]*?)(<\/td>)/g,
      (whole, open, id, inner, close) => inner.includes('onclick=') ? whole
        : `${open}${inner}<a onclick="kyozaiTitleLink('${id}','02')"></a>${close}`);
    if (ended) list = list.replace(/(<td class="kyozaititleCell" id="REP\d+">[\s\S]*?<\/td>\s*<td class="jyugyeditCell">)[\s\S]*?(<\/td>)/g,
      '$1公開終了$2');
    const html = url.includes('linkKougi') ? list + '<form id="main_form" name="corsCollActionForm"><input name="jyugyoHiddenId" value="synthetic-folder"></form>'
      : url.includes('linkKyozaiTitle') ? detail.replaceAll('架空課題04', `架空課題${fields.get('kyozaiId')}`)
        .replaceAll('2098/11/13 (木)', extended ? '2098/11/14 (金)' : '2098/11/13 (木)')
        : home + '<form id="homeHomlForm" name="homeHomlActionForm"><input name="kougiId"><input name="nendo" value="2098"></form>';
    return { ok: true, status: 200, url, text: async () => html };
  });
  const backgroundFetch = lmsFetch(backgroundCalls), pageFetch = lmsFetch(pageCalls);
  const fetcher = vi.fn(async (url, init) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) {
      if (backgroundBlocked) throw new Error('synthetic-background-block');
      return backgroundFetch(url, init);
    }
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
      expect(init.headers.Authorization).toBe('Bearer synthetic-google-token');
      googleCalls.push([url, init.method]);
      const path = new URL(url).pathname;
      const eventId = path.split('/').at(-1);
      if (init.method === 'GET') return events.has(eventId) ? reply(200, events.get(eventId)) : reply(404);
      if (init.method === 'DELETE') { events.delete(eventId); return reply(204); }
      expect(['POST', 'PUT']).toContain(init.method);
      expect(path).toBe(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${init.method === 'PUT' ? `/${eventId}` : ''}`);
      const event = JSON.parse(init.body);
      events.set(event.id, event);
      return reply(200, event);
    }
    expect(init.headers.Authorization).toBe('Bearer synthetic-id-token');
    if (url === `${config.apiOrigin}/api/v1/calendar-sync`) {
      if (init.method === 'GET') return reply(200, {
        integration: { mode: 'google', executor: 'extension', calendarId, connectionState: 'connected' },
        items: [...items.values()].filter(item => item.appliedRevision !== item.desiredRevision),
      });
      const report = JSON.parse(init.body);
      reports.push(report);
      items.set(report.itemKey, acknowledgeCalendarItem(items.get(report.itemKey), report, new Date().toISOString()));
      return reply(200, { ok: true });
    }
    expect(url).toBe(`${config.apiOrigin}/api/v1/observations`);
    const observation = parseObservation(JSON.parse(init.body));
    apiBodies.push(observation);
    // Replace transport/storage only; use the product's ledger and event calculation.
    const applied = applyObservation(ledger, observation, new Date().toISOString());
    ledger = applied.assignments;
    changes.push(...applied.changes);
    for (const assignment of ledger) {
      const key = createHash('sha256').update(JSON.stringify([assignment.key.system, assignment.key.sourceId])).digest('hex');
      const course = observation.catalogCourses.find(c => c.courseId === assignment.latest.courseId);
      const next = reconcileCalendarItem(items.get(key), key, assignment, course.name, connected ? calendarId : null,
        () => randomUUID().replaceAll('-', ''));
      if (next) items.set(key, next);
    }
    return reply(200, applied.result);
  });
  let elapsed = 0;
  const common = { Date: class extends Date { static now() { return Date.now() + elapsed; } }, URL, URLSearchParams, TextEncoder, AbortSignal: globalThis.AbortSignal, AbortController: globalThis.AbortController, crypto: { randomUUID, subtle: webcrypto.subtle },
    clearTimeout, setTimeout: (fn, ms) => { if (ms >= 4000) return setTimeout(fn, ms); if (ms === 2000) elapsed += ms; globalThis.queueMicrotask(fn); return 0; }, console: { warn: vi.fn() } };
  const call = (listener, message, sender) => new Promise(resolve => listener(message, sender, resolve));
  const getAuthToken = vi.fn(async options => { expect(options.interactive).toBe(false); return { token: 'synthetic-google-token' }; });
  const workerContext = createContext({ ...common, sdk, fetch: fetcher, chrome: {
    identity: { getAuthToken },
    runtime: { id: 'synthetic-extension', onStartup: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, onMessage: { addListener: fn => { workerListener = fn; } } },
    storage: { session: { set: async values => Object.assign(state, globalThis.structuredClone(values)), get: async () => globalThis.structuredClone(state) } },
    tabs: { query: async () => [{ id: 7 }], get: async () => ({ id: 7, status: 'complete' }), sendMessage: async (tabId, message, target) => {
      expect(tabId).toBe(7); expect(target).toEqual({ frameId: 0, documentId: 'synthetic-document' });
      return call(contentListener, message, { id: 'synthetic-extension' });
    } },
  } }, { codeGeneration: { strings: false, wasm: false } });
  const { document } = parseHTML('<html><body><main>架空のLMS</main></body></html>');
  const contentContext = createContext({ ...common, document, fetch: pageFetch, window: { location: { href: pageUrl }, addEventListener: () => {} }, chrome: {
    runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => { contentListener = fn; } },
      sendMessage: message => {
        trigger = call(workerListener, message, { id: 'synthetic-extension', frameId: 0, url: pageUrl, tab: { id: 7 }, documentId: 'synthetic-document' });
        return trigger;
      } },
  } }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(worker.outputFiles[0].text, workerContext);
  trigger = undefined;
  runInContext(content.outputFiles[0].text, contentContext);
  await new Promise(resolve => setImmediate(resolve));
  expect(await trigger).toEqual({ ok: true, changed: true, changeCount: 198 });
  await vi.waitFor(() => expect([...document.body.children].some(node => node.shadowRoot)).toBe(true));
  const notice = [...document.body.children].find(node => node.shadowRoot).shadowRoot.querySelector('a');
  expect(notice.textContent).toBe('課題の変更が198件あります。学生の画面を開く');
  expect(notice.href).toBe('https://synthetic.web.app/student');
  expect(apiBodies).toHaveLength(1);
  const observation = apiBodies[0];
  expect(observation.catalogCourses).toHaveLength(22);
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.assignments).toHaveLength(198);
  expect(observation.courseResults.every(c => c.listComplete && c.seenSourceIds.length === 9)).toBe(true);
  expect(observation.failures).toEqual([]);
  const calls = backgroundBlocked ? pageCalls : backgroundCalls;
  expect(calls.filter(c => c.url.includes('linkKougi'))).toHaveLength(22);
  expect(calls.filter(c => c.url.includes('linkKyozaiTitle'))).toHaveLength(198);
  expect(backgroundBlocked ? backgroundCalls : pageCalls).toEqual([]);
  expect(JSON.stringify([observation, state.ynuFetchStats, state.ynuFetchStatus])).not.toMatch(/synthetic-session|synthetic-id-token|SID=|Cookie/i);
  expect(state.ynuFetchStats).toEqual({ attempted: 1, backgroundSucceeded: backgroundBlocked ? 0 : 1, pageSucceeded: backgroundBlocked ? 1 : 0, failed: 0 });
  const count = pageCalls.length;
  expect(await call(contentListener, { type: 'ynu-read-page', operation: { kind: 'home' }, sid: 'synthetic-session' }, { id: 'other-extension' })).toEqual({ ok: false });
  expect(await call(contentListener, { type: 'ynu-read-page', operation: { kind: 'home' }, sid: 'other-session' }, { id: 'synthetic-extension' })).toEqual({ ok: false });
  expect(pageCalls).toHaveLength(count);
  expect(ledger).toHaveLength(198);
  if (!connected) {
    expect(events.size).toBe(0);
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/calendar-sync'))).toBe(false);
    return;
  }
  // Calendar sync starts after the accepted observation without delaying the LMS result (PR #74).
  await vi.waitFor(() => expect(reports).toHaveLength(198), { timeout: 10_000 });
  expect(events.size).toBe(198);
  expect(googleCalls.filter(([, method]) => method === 'POST')).toHaveLength(198);
  expect(reports).toHaveLength(198);
  expect([...items.values()].every(item => item.appliedRevision === item.desiredRevision)).toBe(true);
  const originalIds = [...events.keys()];
  expect([...events.values()].every(event => event.start.dateTime === '2098-11-13T11:53:00+09:00')).toBe(true);
  extended = true;
  elapsed += 10 * 60_000;
  // Reopen the page, using the same worker and saved calendar, after the LMS changes.
  trigger = undefined;
  runInContext(content.outputFiles[0].text, contentContext);
  await new Promise(resolve => setImmediate(resolve));
  expect(await trigger).toEqual({ ok: true, changed: true, changeCount: 198 });
  expect(apiBodies).toHaveLength(2);
  expect(apiBodies[1].observationId).not.toBe(apiBodies[0].observationId);
  await vi.waitFor(() => expect(googleCalls.filter(([, method]) => method === 'PUT')).toHaveLength(198), { timeout: 10_000 });
  await vi.waitFor(() => expect(reports).toHaveLength(396), { timeout: 10_000 });
  expect([...events.keys()]).toEqual(originalIds);
  expect(googleCalls.filter(([, method]) => method === 'POST')).toHaveLength(198);
  expect(googleCalls.filter(([, method]) => method === 'PUT')).toHaveLength(198);
  expect([...events.values()].every(event => event.start.dateTime === '2098-11-14T11:53:00+09:00')).toBe(true);
  expect(changes.filter(change => change.kind === 'deadline-changed')).toHaveLength(198);
  expect(ledger.every(item => item.officialDeadline.deadline.dueAt === '2098-11-14T11:53:00+09:00')).toBe(true);
  expect([...items.values()].every(item => item.appliedRevision === item.desiredRevision && item.desiredRevision === 2)).toBe(true);
  ended = true;
  elapsed += 10 * 60_000;
  const priorDetailCount = calls.filter(c => c.url.includes('linkKyozaiTitle')).length;
  trigger = undefined;
  runInContext(content.outputFiles[0].text, contentContext);
  await new Promise(resolve => setImmediate(resolve));
  expect(await trigger).toEqual({ ok: true, changed: true, changeCount: 198 });
  await vi.waitFor(() => expect(reports).toHaveLength(594), { timeout: 10_000 });
  expect(events.size).toBe(0);
  expect(googleCalls.filter(([, method]) => method === 'DELETE')).toHaveLength(198);
  expect(ledger.every(item => item.presenceState === 'ended' && item.consecutiveMissingCount === 0)).toBe(true);
  expect(calls.filter(c => c.url.includes('linkKyozaiTitle'))).toHaveLength(priorDetailCount);
  expect(state.ynuFetchStatus).toBe('success');
  expect([...items.values()].every(item => item.desired.state === 'deleted' && item.appliedRevision === item.desiredRevision)).toBe(true);
  expect(JSON.stringify([apiBodies, reports, [...events.values()]])).not.toMatch(/synthetic-session|synthetic-id-token|synthetic-google-token|SID=|Cookie/i);
});
