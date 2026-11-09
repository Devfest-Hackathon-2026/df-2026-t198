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
      ? `export const initializeApp = (_settings, name) => ({ name }); export const deleteApp = async () => {};`
      : `export const indexedDBLocalPersistence = {}; export const inMemoryPersistence = {};
         export const initializeAuth = app => app.name ? { isolated: true } : sdk.auth;
         export const GoogleAuthProvider = { credential: (_id, token) => token };
         export const signInWithCredential = (...args) => sdk.signIn(...args);` }));
  } }],
});
const page = { id: undefined, origin: 'https://synthetic.web.app', url: 'https://synthetic.web.app/student', frameId: 0, tab: { id: 1 } };
const calendarId = 'synthetic@group.calendar.google.com';

function fixture({ extensionUid = null, googleUid = 'student', refuse = false, holdDialog = false } = {}) {
  const event = { summary: '架空の授業：課題', description: '締切：11月12日', start: { date: '2026-11-12' }, end: { date: '2026-11-13' },
    transparency: 'transparent', reminders: { useDefault: true } };
  const row = { itemKey: 'a'.repeat(64), eventId: 'abcde', generation: 1, desiredRevision: 1, appliedRevision: 0,
    calendarId, desired: { state: 'present', event } };
  const server = { integration: null }; const stored = {}; const events = new Map(); const calls = [];
  const user = id => ({ uid: id, getIdToken: async () => `synthetic-id-token-${id}` });
  const sdk = { auth: { currentUser: extensionUid ? user(extensionUid) : null, authStateReady: async () => {} },
    signIn: vi.fn(async auth => {
      // The isolated check must never replace the login used for observations.
      if (!auth.isolated) auth.currentUser = user(googleUid);
      return { user: user(googleUid) };
    }) };
  let external; let releaseDialog;
  const dialog = new Promise(resolve => { releaseDialog = resolve; });
  const listener = { addListener: () => {} };
  const chrome = { runtime: { id: 'synthetic-extension', getURL: path => `chrome-extension://synthetic-extension/${path}`,
    onMessage: listener, onStartup: listener, onInstalled: listener, onMessageExternal: { addListener: fn => { external = fn; } } },
    alarms: { onAlarm: listener, clear: vi.fn() },
    storage: { local: { get: async key => (key in stored ? { [key]: stored[key] } : {}), set: async values => { Object.assign(stored, values); },
      remove: async key => { delete stored[key]; }, setAccessLevel: async () => {} }, session: { set: vi.fn() } },
    identity: { getAuthToken: vi.fn(async options => {
      expect(options.scopes).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created']);
      if (options.interactive && holdDialog) await dialog;
      if (refuse) throw new Error('The user did not approve access.');
      return { token: 'synthetic-google-token' };
    }), removeCachedAuthToken: vi.fn() } };
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  const fetch = vi.fn(async (url, options) => {
    calls.push(`${options.method} ${url.replace(config.apiOrigin, 'api:').replace('https://www.googleapis.com/calendar/v3', 'google:')}`);
    expect(options.redirect).toBe('error'); expect(options.credentials).toBe('omit');
    if (url.startsWith(config.apiOrigin)) {
      expect(options.headers.Authorization).toBe('Bearer synthetic-id-token-student');
      if (options.method === 'GET') return response(200, { integration: server.integration,
        items: server.integration && row.appliedRevision !== row.desiredRevision ? [globalThis.structuredClone(row)] : [] });
      const body = JSON.parse(options.body);
      if ('calendarId' in body) server.integration = { mode: 'google', executor: 'extension', calendarId: body.calendarId, connectionState: 'connected' };
      else if (!body.errorCode) row.appliedRevision = body.revision;
      return response(200, { ok: true });
    }
    expect(options.headers.Authorization).toBe('Bearer synthetic-google-token');
    if (url.endsWith('/calendars')) return response(200, { id: calendarId });
    if (options.method === 'GET') return events.has(row.eventId) ? response(200, events.get(row.eventId)) : response(404);
    const body = JSON.parse(options.body); events.set(body.id, body); return response(200, body);
  });
  runInContext(outputFiles[0].text, createContext({ chrome, sdk, fetch, URL, crypto: { randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' } },
    { codeGeneration: { strings: false, wasm: false } }));
  const send = (message, from = page) => new Promise(resolve => { external(message, from, resolve); });
  const created = () => calls.filter(call => call === 'POST google:/calendars');
  return { send, chrome, sdk, calls, created, events, server, stored, releaseDialog };
}
const connect = { type: 'todoku-calendar-connect', uid: 'student' };

it('answers only the top frame of the configured student page, and only well-formed requests', async () => {
  const f = fixture();
  for (const from of [{ ...page, origin: 'https://other.web.app', url: 'https://other.web.app/student' },
    { ...page, url: 'https://synthetic.web.app.example.invalid/student', origin: undefined },
    { ...page, frameId: 3 }, { ...page, url: undefined }]) {
    expect(await f.send(connect, from)).toEqual({ ok: false, code: 'unconfigured' });
  }
  for (const message of [null, 'todoku-calendar-connect', { type: 'todoku-calendar-connect' }, { ...connect, uid: '../other' },
    { ...connect, calendarId: 'chosen-by-the-page' }, { type: 'digest-setting', enabled: true, uid: 'student' }, { type: 'auth-probe-run', uid: 'student' }]) {
    expect(await f.send(message)).toEqual({ ok: false, code: 'unconfigured' });
  }
  expect(f.chrome.identity.getAuthToken).not.toHaveBeenCalled();
  expect(f.calls).toEqual([]);
});

it('tells the page whether the extension is used by the same account', async () => {
  expect(await fixture().send({ type: 'todoku-status', uid: 'student' })).toEqual({ ok: true, account: 'none' });
  expect(await fixture({ extensionUid: 'student' }).send({ type: 'todoku-status', uid: 'student' })).toEqual({ ok: true, account: 'same' });
  expect(await fixture({ extensionUid: 'another' }).send({ type: 'todoku-status', uid: 'student' })).toEqual({ ok: true, account: 'other' });
});

it('one click opens the Google dialog, prepares one calendar and puts the waiting events into it', async () => {
  const f = fixture();
  expect(await f.send(connect)).toEqual({ ok: true, synced: true });
  expect(f.chrome.identity.getAuthToken.mock.calls[0][0].interactive).toBe(true);
  expect(f.sdk.auth.currentUser.uid).toBe('student');
  expect(f.server.integration.calendarId).toBe(calendarId);
  expect([...f.events.keys()]).toEqual(['abcde']);
  const writes = () => f.calls.filter(call => call.startsWith('POST google:') || call.startsWith('PUT google:'));
  expect(writes()).toEqual(['POST google:/calendars', `POST google:/calendars/${encodeURIComponent(calendarId)}/events`]);
  // Reconnecting changes neither the calendar nor the events.
  expect(await f.send(connect)).toEqual({ ok: true, synced: true });
  expect(await f.send({ type: 'todoku-calendar-sync', uid: 'student' })).toEqual({ ok: true, synced: true });
  expect(writes()).toHaveLength(2);
  expect(f.events.size).toBe(1);
});

it('a second click during the Google dialog is refused, so only one calendar is created', async () => {
  const f = fixture({ holdDialog: true });
  const first = f.send(connect);
  await vi.waitFor(() => expect(f.chrome.identity.getAuthToken).toHaveBeenCalledOnce());
  expect(await f.send(connect)).toEqual({ ok: false, code: 'busy' });
  f.releaseDialog();
  expect(await first).toEqual({ ok: true, synced: true });
  expect(f.created()).toHaveLength(1);
});

it('a refused dialog and a different Google account leave the extension and the calendars untouched', async () => {
  const refused = fixture({ refuse: true });
  expect(await refused.send(connect)).toEqual({ ok: false, code: 'authorization-denied' });
  const other = fixture({ googleUid: 'another' });
  expect(await other.send(connect)).toEqual({ ok: false, code: 'account-mismatch' });
  const occupied = fixture({ extensionUid: 'another' });
  expect(await occupied.send(connect)).toEqual({ ok: false, code: 'account-mismatch' });
  expect(occupied.chrome.identity.getAuthToken).not.toHaveBeenCalled();
  for (const f of [refused, other, occupied]) {
    expect(f.created()).toEqual([]); expect(f.server.integration).toBeNull(); expect(f.stored).toEqual({});
  }
  expect(refused.sdk.auth.currentUser).toBeNull(); expect(other.sdk.auth.currentUser).toBeNull();
  expect(occupied.sdk.auth.currentUser.uid).toBe('another');
  // After a refusal the same button works again.
  expect(await refused.send(connect)).toEqual({ ok: false, code: 'authorization-denied' });
});

it('a sync request never opens a dialog and reports what the student has to do', async () => {
  const none = fixture();
  expect(await none.send({ type: 'todoku-calendar-sync', uid: 'student' })).toEqual({ ok: false, code: 'not-connected' });
  const other = fixture({ extensionUid: 'another' });
  expect(await other.send({ type: 'todoku-calendar-sync', uid: 'student' })).toEqual({ ok: false, code: 'account-mismatch' });
  const unsaved = fixture({ extensionUid: 'student' });
  expect(await unsaved.send({ type: 'todoku-calendar-sync', uid: 'student' })).toEqual({ ok: false, code: 'reauthorization-required' });
  for (const f of [none, other, unsaved]) expect(f.chrome.identity.getAuthToken.mock.calls.every(([options]) => !options.interactive)).toBe(true);
});
