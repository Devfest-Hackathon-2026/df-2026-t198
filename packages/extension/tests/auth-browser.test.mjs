import { afterEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn((settings, name) => ({ settings, name })),
  deleteApp: vi.fn(async () => {}),
  initializeAuth: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp, deleteApp: sdk.deleteApp }));
vi.mock('firebase/auth/web-extension', () => ({
  indexedDBLocalPersistence: { type: 'LOCAL' },
  inMemoryPersistence: { type: 'NONE' },
  initializeAuth: sdk.initializeAuth,
  GoogleAuthProvider: { credential: (_idToken, accessToken) => ({ accessToken }) },
  signInWithCredential: sdk.signIn,
}));
vi.mock('../src/auth/config.js', () => ({
  probeConfig: { apiOrigin: 'https://api.example.invalid', oauthClientId: '123-test.apps.googleusercontent.com',
    firebase: { projectId: 'synthetic' } },
  missingConfig: () => [],
}));
afterEach(() => { vi.unstubAllGlobals(); });

async function fixture(googleUid = 'other') {
  vi.resetModules(); vi.clearAllMocks();
  const owner = { uid: 'owner', email: 'owner@example.invalid', getIdToken: async () => 'synthetic-owner-id-token' };
  const shared = { currentUser: owner, authStateReady: async () => {} };
  sdk.initializeAuth.mockImplementation((app) => app.name ? { currentUser: null } : shared);
  // Model Firebase's real side effect on the Auth instance supplied by the caller.
  sdk.signIn.mockImplementation(async (auth) => {
    auth.currentUser = { uid: googleUid, email: `${googleUid}@example.invalid`, getIdToken: async () => 'synthetic-other-id-token' };
    return { user: auth.currentUser };
  });
  const chrome = {
    runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}` },
    identity: { getAuthToken: vi.fn(async () => ({ token: 'synthetic-google-token' })) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), setAccessLevel: vi.fn(async () => {}) } },
  };
  const fetch = vi.fn();
  vi.stubGlobal('chrome', chrome); vi.stubGlobal('fetch', fetch);
  const browser = await import('../src/auth/browser.js');
  browser.firebaseAuth();
  return { ...browser, owner, shared, chrome, fetch };
}

it.each(['owner', 'other'])('keeps the observation identity intact when checking Google UID %s', async googleUid => {
  const f = await fixture(googleUid);
  expect(await f.confirmGoogleIdentity('synthetic-google-token', 'owner')).toBe(googleUid === 'owner');
  expect(f.shared.currentUser).toBe(f.owner);
  expect(await f.observationIdentity()).toEqual({ uid: 'owner', token: 'synthetic-owner-id-token' });
  expect(sdk.signIn.mock.calls[0][0]).not.toBe(f.shared);
  expect(sdk.initializeAuth.mock.calls[1][1].persistence.type).toBe('NONE');
  expect(sdk.deleteApp).toHaveBeenCalledExactlyOnceWith(sdk.initializeApp.mock.results[1].value);
});

it('disposes the isolated auth after a rejected check without changing the observation user', async () => {
  const f = await fixture();
  sdk.signIn.mockRejectedValueOnce(new Error('synthetic-sdk-failure'));
  await expect(f.confirmGoogleIdentity('synthetic-google-token', 'owner')).rejects.toThrow('synthetic-sdk-failure');
  expect(f.shared.currentUser).toBe(f.owner);
  expect(await f.observationIdentity()).toEqual({ uid: 'owner', token: 'synthetic-owner-id-token' });
  expect(sdk.deleteApp).toHaveBeenCalledTimes(1);
});

it('isolates concurrent checks and disposes each temporary app', async () => {
  const f = await fixture();
  const finish = [];
  sdk.signIn.mockImplementation(auth => new Promise(resolve => finish.push(uid => {
    auth.currentUser = { uid }; resolve({ user: auth.currentUser });
  })));
  const first = f.confirmGoogleIdentity('synthetic-first-token', 'owner');
  const second = f.confirmGoogleIdentity('synthetic-second-token', 'owner');
  expect(sdk.signIn.mock.calls[0][0]).not.toBe(sdk.signIn.mock.calls[1][0]);
  expect(sdk.initializeApp.mock.calls[1][1]).not.toBe(sdk.initializeApp.mock.calls[2][1]);
  finish[1]('other'); finish[0]('owner');
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(f.shared.currentUser).toBe(f.owner);
  expect(sdk.deleteApp).toHaveBeenCalledTimes(2);
});

it('sends the next observation with the original Firebase token after a mismatched Google check', async () => {
  const f = await fixture();
  f.chrome.storage.local.get.mockResolvedValue({ authProbeState: {
    namespace: 'synthetic:123-test.apps.googleusercontent.com', uid: 'owner',
    calendar: { status: 'ready', id: 'synthetic-calendar' },
  } });
  f.fetch.mockImplementation(async (url, options) => {
    expect(options.headers.Authorization).toBe('Bearer synthetic-owner-id-token');
    return { ok: true, json: async () => url.endsWith('/observations')
      ? { status: 'applied' } : { integration: { mode: 'google', executor: 'extension', calendarId: 'synthetic-calendar' }, items: [] } };
  });
  expect(await f.confirmGoogleIdentity('synthetic-google-token', 'owner')).toBe(false);
  const { sendObservation } = await import('../src/calendar/browser.js');
  const observation = { schemaVersion: 1, observationId: '11111111-1111-4111-8111-111111111111',
    system: 'ynu-lms', definitionId: 'coursepower', definitionVersion: 1, fetchedAt: '2026-11-09T00:00:00Z',
    catalogCourses: [], courseResults: [], assignments: [], failures: [] };
  expect(await sendObservation(observation)).toEqual({ status: 'applied' });
  expect(f.fetch).toHaveBeenCalledWith('https://api.example.invalid/api/v1/observations',
    expect.objectContaining({ method: 'POST', body: JSON.stringify(observation) }));
});

it('rejects Gmail opt-in for a different Google account and preserves the next observation identity', async () => {
  const f = await fixture();
  const { handleDigestMessage } = await import('../src/digest/browser.js');
  const result = await new Promise(resolve => handleDigestMessage({ type: 'digest-setting', enabled: true },
    { id: 'extension', url: f.chrome.runtime.getURL('options.html') }, resolve));
  expect(result).toEqual({ ok: false, enabled: false, problem: 'authorization-required' });
  expect(await f.observationIdentity()).toEqual({ uid: 'owner', token: 'synthetic-owner-id-token' });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.chrome.storage.local.set).not.toHaveBeenCalled();
});
