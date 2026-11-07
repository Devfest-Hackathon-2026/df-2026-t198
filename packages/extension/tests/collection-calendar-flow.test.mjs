import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { setImmediate } from 'node:timers';
import { expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

const config = {
  apiOrigin: 'https://api.example.invalid', oauthClientId: '123-synthetic.apps.googleusercontent.com',
  firebase: { apiKey: 'synthetic', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic' },
};
const observation = {
  schemaVersion: 1, observationId: '00000000-0000-4000-8000-000000000001', system: 'ynu-lms',
  definitionId: 'coursepower', definitionVersion: 3, fetchedAt: '2098-11-01T00:00:00Z',
  catalogCourses: [], courseResults: [], assignments: [], failures: [],
};
const worker = await build({
  entryPoints: [fileURLToPath(new URL('../src/service-worker.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  plugins: [{ name: 'synthetic-collection-and-identity', setup(builder) {
    builder.onResolve({ filter: /auth-probe-browser\.js$/ }, () => ({ path: 'identity', namespace: 'fake' }));
    builder.onResolve({ filter: /\/collection\.js$/ }, () => ({ path: 'collection', namespace: 'fake' }));
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, ({ path }) => ({ contents: path === 'collection'
      ? `export const collectObservation = async () => (${JSON.stringify(observation)});`
      : `export const observationIdentity = async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' });
         export const firebaseAuth = () => ({ authStateReady: async () => {},
           currentUser: { uid: 'synthetic-user', getIdToken: async () => 'synthetic-id-token' } });
         export const readProbeState = async () => ({ uid: 'synthetic-user',
           namespace: 'synthetic:123-synthetic.apps.googleusercontent.com',
           calendar: { status: 'ready', id: 'dedicated@group.calendar.google.com' } });
         export const confirmGoogleIdentity = async () => true;
         export const browserProbe = () => { throw new Error('interactive-auth-forbidden'); };` }));
  } }],
});

async function fixture({ uploadStatus = 200, googleStatus = 200, holdPendingRead = false } = {}) {
  const state = {}, calls = [], reports = [], events = new Map();
  let listener, pending = false, syncReads = 0;
  const row = {
    itemKey: 'a'.repeat(64), sourceKey: { system: 'ynu-lms', sourceId: 'synthetic-task' }, kind: 'deadline',
    calendarId: 'dedicated@group.calendar.google.com', eventId: 'abcde', generation: 1,
    desiredRevision: 1, appliedRevision: 0,
    desired: { state: 'present', event: { summary: '架空の授業：架空の課題', description: '締切：11月12日まで',
      start: { date: '2098-11-12' }, end: { date: '2098-11-13' }, transparency: 'transparent', reminders: { useDefault: true } } },
  };
  const integration = { mode: 'google', executor: 'extension', calendarId: row.calendarId, connectionState: 'connected' };
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  const fetch = vi.fn(async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    if (url.startsWith(config.apiOrigin)) {
      expect(options.headers.Authorization).toBe('Bearer synthetic-id-token');
      if (url.endsWith('/observations')) {
        expect(JSON.parse(options.body)).toEqual(observation);
        pending = uploadStatus === 200;
        return response(uploadStatus, { status: 'applied', changed: true, changeCount: 1 });
      }
      expect(url).toBe(`${config.apiOrigin}/api/v1/calendar-sync`);
      if (options.method === 'GET') {
        syncReads++;
        if (holdPendingRead && pending) return new Promise(() => {});
        return response(200, { integration, items: pending ? [globalThis.structuredClone(row)] : [] });
      }
      const report = JSON.parse(options.body);
      reports.push(report);
      if (!report.errorCode) pending = false;
      return response(200, { ok: true });
    }
    expect(url.startsWith(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(row.calendarId)}/events`)).toBe(true);
    expect(options.headers.Authorization).toBe('Bearer synthetic-google-token');
    if (googleStatus !== 200) return response(googleStatus);
    if (options.method === 'GET') return events.has(row.eventId) ? response(200, events.get(row.eventId)) : response(404);
    const body = JSON.parse(options.body);
    events.set(body.id, body);
    return response(200, body);
  });
  const getAuthToken = vi.fn(async ({ interactive }) => {
    expect(interactive).toBe(false);
    return { token: 'synthetic-google-token' };
  });
  const chrome = {
    tabs: { query: async () => [{ id: 7 }], get: async () => ({ id: 7, status: 'complete' }), sendMessage: async () => ({ ok: true }) },
    runtime: { id: 'synthetic-extension', getURL: path => `chrome-extension://synthetic-extension/${path}`,
      onMessage: { addListener: fn => { listener = fn; } }, onStartup: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() } },
    storage: { session: { get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, values) } },
    identity: { getAuthToken, removeCachedAuthToken: vi.fn() },
  };
  runInContext(worker.outputFiles[0].text, createContext({ chrome, fetch, URL, TextEncoder, AbortSignal: globalThis.AbortSignal,
    AbortController: globalThis.AbortController, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    crypto: { randomUUID: () => 'synthetic-worker', subtle: webcrypto.subtle } }, { codeGeneration: { strings: false, wasm: false } }));
  chrome.runtime.onStartup.addListener.mock.calls.forEach(([listener]) => listener());
  await vi.waitFor(() => expect(syncReads).toBe(1));
  // Let the initial empty startup drain finish before creating newly pending work.
  await new Promise(resolve => setImmediate(resolve));
  const openLms = () => new Promise(resolve => listener({ type: 'ynu-session-found', sid: 'synthetic-session' },
    { id: chrome.runtime.id, frameId: 0, tab: { id: 7 }, documentId: 'synthetic-document',
      url: 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session' }, resolve));
  return { openLms, calls, reports, events, state, getAuthToken };
}

it('syncs newly pending deadlines after an LMS observation is accepted without restarting the worker', async () => {
  const f = await fixture();
  expect(await f.openLms()).toEqual({ ok: true, changed: true, changeCount: 1 });
  await vi.waitFor(() => {
    expect(f.events.size).toBe(1);
    expect(f.reports).toEqual([expect.objectContaining({ itemKey: 'a'.repeat(64), revision: 1, errorCode: null })]);
  });
  const uploaded = f.calls.findIndex(call => call.url.endsWith('/observations'));
  expect(f.calls.slice(uploaded + 1).some(call => call.url.endsWith('/calendar-sync'))).toBe(true);
  expect(JSON.stringify([...f.events.values()])).not.toMatch(/synthetic-session|synthetic-id-token|synthetic-google-token/);
  expect(f.state.ynuFetchStatus).toBe('success');
});

it('does not send calendar writes when the LMS observation is rejected', async () => {
  const f = await fixture({ uploadStatus: 401 });
  expect(await f.openLms()).toEqual({ ok: false, code: 'send-failed' });
  expect(f.events.size).toBe(0);
  expect(f.reports).toEqual([]);
  expect(f.getAuthToken).not.toHaveBeenCalled();
  const uploaded = f.calls.findIndex(call => call.url.endsWith('/observations'));
  expect(uploaded).toBeGreaterThanOrEqual(0);
  expect(f.calls.slice(uploaded + 1).some(call => call.url.endsWith('/calendar-sync'))).toBe(false);
});

it('keeps an accepted LMS observation successful when Google Calendar is unavailable', async () => {
  const f = await fixture({ googleStatus: 503 });
  expect(await f.openLms()).toEqual({ ok: true, changed: true, changeCount: 1 });
  await vi.waitFor(() => expect(f.reports).toEqual([expect.objectContaining({ errorCode: 'calendar-unavailable' })]));
  expect(f.events.size).toBe(0);
  expect(f.state.ynuFetchStatus).toBe('success');
});

it('returns an accepted observation and collection status while the calendar read remains unresolved', async () => {
  const f = await fixture({ holdPendingRead: true });
  let result;
  void f.openLms().then(value => { result = value; });
  await vi.waitFor(() => {
    const uploaded = f.calls.findIndex(call => call.url.endsWith('/observations'));
    expect(uploaded).toBeGreaterThanOrEqual(0);
    expect(f.calls.slice(uploaded + 1).some(call => call.url.endsWith('/calendar-sync'))).toBe(true);
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(result).toEqual({ ok: true, changed: true, changeCount: 1 });
  expect(f.state.ynuFetchStatus).toBe('success');
  expect(f.events.size).toBe(0);
  expect(f.reports).toEqual([]);
});
