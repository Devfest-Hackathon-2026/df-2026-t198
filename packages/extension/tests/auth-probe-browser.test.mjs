import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const config = {
  oauthClientId: '123-synthetic.apps.googleusercontent.com',
  firebase: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' },
};

// Bundle the actual worker against virtual Firebase exports: no SDK or real accounts are used.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/service-worker.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  plugins: [{
    name: 'fake-firebase',
    setup(builder) {
      builder.onResolve({ filter: /^firebase\// }, ({ path }) => ({ path, namespace: 'fake-firebase' }));
      builder.onLoad({ filter: /.*/, namespace: 'fake-firebase' }, ({ path }) => ({
        contents: path === 'firebase/app'
          ? `export const initializeApp = (...args) => globalThis.sdk.initializeApp(...args);
             export const deleteApp = async () => {};`
          : `export const indexedDBLocalPersistence = { type: 'LOCAL' };
             export const inMemoryPersistence = { type: 'NONE' };
             export const initializeAuth = (...args) => globalThis.sdk.initializeAuth(...args);
             export const GoogleAuthProvider = { credential: (...args) => globalThis.sdk.credential(...args) };
             export const signInWithCredential = (...args) => globalThis.sdk.signIn(...args);`,
      }));
    },
  }],
});

function fixture(storage = {}, persistedUid = null, workerId = '01234567-89ab-cdef-0123-456789abcdef') {
  const order = [];
  const token = 'synthetic-secret-token';
  const uid = 'abcdefgh-private-uid';
  const local = {
    setAccessLevel: vi.fn(async () => undefined),
    get: vi.fn(async () => globalThis.structuredClone(storage)),
    set: vi.fn(async (value) => { Object.assign(storage, globalThis.structuredClone(value)); }),
    remove: vi.fn(async (key) => { delete storage[key]; }),
  };
  const firebaseAuth = {
    currentUser: persistedUid ? { uid: persistedUid } : null,
    authStateReady: vi.fn(async () => { order.push('ready'); }),
  };
  const sdk = {
    initializeApp: vi.fn((settings) => { order.push('app'); return { settings }; }),
    initializeAuth: vi.fn((_app, settings) => { order.push('auth'); expect(settings.persistence.type).toBe('LOCAL'); return firebaseAuth; }),
    credential: vi.fn((idToken, accessToken) => { order.push('credential'); return { idToken, accessToken }; }),
    signIn: vi.fn(async (_auth, credential) => {
      order.push('signIn');
      expect(credential).toEqual({ idToken: null, accessToken: token });
      firebaseAuth.currentUser = { uid };
      return { user: { uid } };
    }),
  };
  const sender = { id: 'synthetic-extension', url: 'chrome-extension://synthetic-extension/options.html' };
  const listeners = [];
  const chrome = {
    runtime: { id: sender.id, getURL: (path) => `chrome-extension://${sender.id}/${path}`, onMessage: { addListener: (fn) => listeners.push(fn) } },
    identity: { getAuthToken: vi.fn(async (options) => { order.push('token'); expect(options).toEqual({ interactive: true,
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'] }); return { token }; }) },
    storage: { local, session: { set: vi.fn() } },
  };
  const fetch = vi.fn(async (url, options) => {
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(options.redirect).toBe('error');
    expect(url.startsWith('https://www.googleapis.com/calendar/v3/calendars')).toBe(true);
    const data = url.endsWith('/calendars') ? { id: 'synthetic-calendar' } : JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => data };
  });
  const context = createContext({ chrome, sdk, fetch, crypto: { randomUUID: () => workerId } }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(outputFiles[0].text, context);
  const send = async (type, from = sender) => {
    let value;
    const handled = listeners[0]({ type }, from, (result) => { value = result; });
    await vi.waitFor(() => expect(value).toBeDefined());
    return { handled, result: value };
  };
  return { send, sender, sdk, chrome, fetch, order, storage, firebaseAuth, uid, token };
}

describe('service worker with fake Chrome and Firebase', () => {
  it('uses IndexedDB persistence, authenticates from a click, and only returns safe results', async () => {
    const f = fixture();
    const { handled, result } = await f.send('auth-probe-run');
    expect(handled).toBe(true);
    expect(f.order).toEqual(['app', 'auth', 'ready', 'token', 'credential', 'signIn']);
    expect(f.sdk.initializeApp).toHaveBeenCalledWith(config.firebase);
    expect(f.chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(result.steps.every((step) => step.status === 'ok')).toBe(true);
    expect(result.uidPrefix).toBe('abcdefgh');
    expect(JSON.stringify(result)).not.toContain(f.uid);
    expect(JSON.stringify([result, f.storage])).not.toContain(f.token);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    // A passive check cannot authorize or write another event.
    expect((await f.send('auth-probe-status')).result.sameUid).toBe(true);
    expect(f.chrome.identity.getAuthToken).toHaveBeenCalledTimes(1);
    expect(f.sdk.initializeAuth).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    {},
    { id: 'other-extension', url: 'chrome-extension://synthetic-extension/options.html' },
    { id: 'synthetic-extension', url: 'https://lms.ynu.ac.jp/' },
    { id: 'synthetic-extension', url: 'chrome-extension://synthetic-extension/options.html?forged=1' },
    { id: 'synthetic-extension', url: 'chrome-extension://synthetic-extension/options.html', frameId: 1 },
  ])('rejects another sender before using credentials or storage', async (sender) => {
    const f = fixture();
    expect((await f.send('auth-probe-run', sender)).result.steps[0].code).toBe('untrusted-sender');
    expect(f.sdk.initializeApp).not.toHaveBeenCalled();
    expect(f.chrome.identity.getAuthToken).not.toHaveBeenCalled();
    expect(f.chrome.storage.local.setAccessLevel).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('hides Chrome and Firebase rejection details', async () => {
    for (const failure of ['chrome', 'firebase']) {
      const f = fixture();
      const mock = failure === 'chrome' ? f.chrome.identity.getAuthToken : f.sdk.signIn;
      mock.mockRejectedValueOnce(new Error(f.token));
      const { result } = await f.send('auth-probe-run');
      expect(result.steps.at(-1).status).toBe('error');
      expect(JSON.stringify(result)).not.toContain(f.token);
      expect(f.fetch).not.toHaveBeenCalled();
    }
  });

  it('displays the HTTP status without reading an API error body', async () => {
    const f = fixture();
    const json = vi.fn(() => { throw new Error(f.token); });
    f.fetch.mockResolvedValueOnce({ ok: false, status: 403, json });
    const { result } = await f.send('auth-probe-run');
    expect(result.steps.at(-1)).toMatchObject({ status: 'error', code: 'calendar-http' });
    expect(result.steps.at(-1).message).toContain('HTTP 403');
    expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(f.token);
  });

  it.each(['before-dispatch', 400, 401, 403])('retries calendar creation after definite non-creation: %s', async failure => {
    const f = fixture();
    if (failure === 'before-dispatch') f.fetch.mockImplementationOnce(() => { throw new Error(f.token); });
    else f.fetch.mockResolvedValueOnce({ ok: false, status: failure });
    const { result } = await f.send('auth-probe-run');
    expect(result.steps.at(-1).status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(f.token);
    expect(f.storage.authProbeState).toBeUndefined();
    // Retry from persisted storage after a worker restart, not just the same object.
    const resumed = fixture(f.storage, f.uid);
    expect((await resumed.send('auth-probe-run')).result.steps.at(-1).status).toBe('ok');
    expect(resumed.fetch.mock.calls.filter(([url]) => url.endsWith('/calendars'))).toHaveLength(1);
  });

  it.each(['lost-response', 'unreadable-success', 500])('does not retry an uncertain creation after worker restart: %s', async failure => {
    const f = fixture();
    if (failure === 'lost-response') f.fetch.mockRejectedValueOnce(new Error(f.token));
    else if (failure === 'unreadable-success') f.fetch.mockResolvedValueOnce({ ok: true, status: 200,
      json: async () => { throw new Error(f.token); } });
    else f.fetch.mockResolvedValueOnce({ ok: false, status: failure });
    const { result } = await f.send('auth-probe-run');
    expect(result.steps.at(-1).status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(f.token);
    expect(f.storage.authProbeState.calendar.status).toBe('creating');
    const resumed = fixture(f.storage, f.uid);
    expect((await resumed.send('auth-probe-run')).result.steps.at(-1).code).toBe('calendar-recovery-required');
    expect(resumed.fetch).not.toHaveBeenCalled();
  });

  it('restores the same UID after starting a new worker without acquiring another token', async () => {
    const first = fixture();
    await first.send('auth-probe-run');
    const resumed = fixture(first.storage, first.uid, '11111111-1111-1111-1111-111111111111');
    const { result } = await resumed.send('auth-probe-status');
    expect(result).toMatchObject({ uidPrefix: 'abcdefgh', sameUid: true, workerChanged: true });
    expect(resumed.chrome.identity.getAuthToken).not.toHaveBeenCalled();
    expect(resumed.sdk.signIn).not.toHaveBeenCalled();
    expect(resumed.fetch).not.toHaveBeenCalled();
  });

  it('rejects simultaneous clicks and allows a later retry', async () => {
    const f = fixture();
    let release;
    f.chrome.identity.getAuthToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = f.send('auth-probe-run');
    await vi.waitFor(() => expect(release).toBeDefined());
    expect((await f.send('auth-probe-run')).result.steps[0].code).toBe('busy');
    release({ token: f.token });
    await first;
    expect((await f.send('auth-probe-status')).result.sameUid).toBe(true);
  });
});
