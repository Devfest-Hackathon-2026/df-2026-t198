import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { expect, it, vi } from 'vitest';

const config = { apiOrigin: 'https://api.example.invalid', oauthClientId: '123-synthetic.apps.googleusercontent.com',
  firebase: { apiKey: 'synthetic', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic' } };
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/service-worker.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  plugins: [{ name: 'fake-firebase', setup(builder) {
    builder.onResolve({ filter: /^firebase\// }, ({ path }) => ({ path, namespace: 'fake' }));
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, ({ path }) => ({ contents: path === 'firebase/app'
      ? 'export const initializeApp = () => ({});'
      : `export const indexedDBLocalPersistence = {}; export const initializeAuth = () => sdk.auth;
         export const GoogleAuthProvider = { credential: (_id, token) => token };
         export const signInWithCredential = (...args) => sdk.signIn(...args);` }));
  } }],
});
function fixture({ savedUid = 'owner', googleUid = 'owner' } = {}) {
  const event = { summary: '授業：課題', description: '締切：11月12日', start: { date: '2026-11-12' }, end: { date: '2026-11-13' },
    transparency: 'transparent', reminders: { useDefault: true } };
  const row = { itemKey: 'a'.repeat(64), eventId: 'abcde', generation: 1, desiredRevision: 1, appliedRevision: 0,
    calendarId: 'synthetic@group.calendar.google.com', desired: { state: 'present', event } };
  const integration = { mode: 'google', executor: 'extension', calendarId: row.calendarId, connectionState: 'connected' };
  const reports = []; const apiBodies = []; const events = new Map(); const calls = [];
  const idToken = 'synthetic-firebase-token'; const googleToken = 'synthetic-google-token';
  const sdk = { auth: { currentUser: { uid: 'owner', getIdToken: async () => idToken }, authStateReady: async () => {} },
    signIn: vi.fn(async () => ({ user: { uid: googleUid } })) };
  const state = { namespace: `${config.firebase.projectId}:${config.oauthClientId}`, uid: savedUid,
    calendar: { status: 'ready', id: row.calendarId } };
  let onMessage; let onStartup;
  const sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic-extension/options.html', frameId: 0 };
  const chrome = { runtime: { id: sender.id, getURL: path => `chrome-extension://${sender.id}/${path}`,
    onMessage: { addListener: fn => { onMessage = fn; } }, onStartup: { addListener: fn => { onStartup = fn; } } },
    storage: { local: { get: async () => ({ authProbeState: state }), setAccessLevel: async () => {} }, session: { set: vi.fn() } },
    identity: { getAuthToken: vi.fn(async options => { expect(options).toEqual({ interactive: false,
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'] }); return { token: googleToken }; }), removeCachedAuthToken: vi.fn() } };
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  const fetch = vi.fn(async (url, options) => {
    calls.push([url, options.method]);
    expect(options.redirect).toBe('error'); expect(options.credentials).toBe('omit');
    if (url.startsWith(config.apiOrigin)) {
      expect(options.headers.Authorization).toBe(`Bearer ${idToken}`);
      if (options.method === 'GET') return response(200, { integration, items: row.appliedRevision === row.desiredRevision ? [] : [globalThis.structuredClone(row)] });
      const body = JSON.parse(options.body); apiBodies.push(body);
      if (url.endsWith('/observations')) { row.desiredRevision++; return response(200, { status: 'applied', changed: true, changeCount: 1 }); }
      reports.push(body); if (!body.errorCode) row.appliedRevision = body.revision;
      return response(200, { ok: true });
    }
    expect(options.headers.Authorization).toBe(`Bearer ${googleToken}`);
    expect(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/')).toBe(true);
    if (options.method === 'GET') return events.has(row.eventId) ? response(200, events.get(row.eventId)) : response(404);
    const body = JSON.parse(options.body); events.set(body.id, body); return response(200, body);
  });
  runInContext(outputFiles[0].text, createContext({ chrome, sdk, fetch, crypto: { randomUUID: () => 'synthetic-worker' } },
    { codeGeneration: { strings: false, wasm: false } }));
  async function send(message, from = sender) {
    let result; onMessage(message, from, value => { result = value; });
    await vi.waitFor(() => expect(result).toBeDefined()); return result;
  }
  return { send, onStartup: () => onStartup(), chrome, reports, events, row, calls, fetch, apiBodies, sdk };
}
it('resumes pending work at worker startup with separate credentials and no interactive prompt', async () => {
  const f = fixture(); await vi.waitFor(() => expect(f.row.appliedRevision).toBe(1));
  expect(f.events.size).toBe(1); expect(f.sdk.signIn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.apiBodies)).not.toMatch(/synthetic-google-token|synthetic-firebase-token/);
  f.onStartup(); await vi.waitFor(() => expect(f.calls.filter(c => c[0].endsWith('/calendar-sync') && c[1] === 'GET').length).toBeGreaterThan(1));
  expect(f.events.size).toBe(1);
});
it('syncs immediately after a trusted observation send and rejects untrusted callers', async () => {
  const f = fixture(); await vi.waitFor(() => expect(f.row.appliedRevision).toBe(1));
  expect(await f.send({ type: 'observation-send', observation: { synthetic: true } })).toMatchObject({ ok: true, result: { status: 'applied' } });
  expect(f.row.appliedRevision).toBe(2); expect(f.events.size).toBe(1);
  const observed = f.calls.findIndex(c => c[0].endsWith('/observations'));
  expect(f.calls.slice(observed + 1).some(c => c[0].endsWith('/calendar-sync'))).toBe(true);
  const before = f.fetch.mock.calls.length;
  expect(await f.send({ type: 'observation-send', observation: {} }, { id: 'synthetic-extension', url: 'https://lms.ynu.ac.jp/', frameId: 0 })).toEqual({ ok: false });
  expect(f.fetch).toHaveBeenCalledTimes(before);
});
it('does not fetch or write another stored user’s calendar', async () => {
  const f = fixture({ savedUid: 'other' });
  expect(await f.send({ type: 'calendar-sync' })).toEqual({ ok: false });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.chrome.identity.getAuthToken).not.toHaveBeenCalled();
});
it('does not write Google events when Chrome and Firebase identify different accounts', async () => {
  const f = fixture({ googleUid: 'other' });
  await vi.waitFor(() => expect(f.reports).toHaveLength(1));
  expect(f.reports[0].errorCode).toBe('authorization-required'); expect(f.events.size).toBe(0);
  expect(f.calls.every(c => c[0].startsWith(config.apiOrigin))).toBe(true);
});
