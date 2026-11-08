import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

const origin = 'https://todoku.example';

function worker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string | Request) => entries.get(typeof key === 'string' ? key : key.url)?.clone()),
    put: vi.fn(async (key: string | Request, response: Response) => {
      entries.set(typeof key === 'string' ? key : key.url, response.clone());
    }),
  };
  const fetch = vi.fn(async () => new Response('<div id="root">current</div>', { headers: { 'content-type': 'text/html' } }));
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['todoku-pwa-old', 'other-app']), delete: vi.fn() };
  const self = { location: { origin }, skipWaiting: vi.fn(), clients: { claim: vi.fn() },
    addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; } };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch, URL });
  function request(path: string, options: { method?: string; mode?: string } = {}) {
    const request = { url: new URL(path, origin).href, method: options.method ?? 'GET', mode: options.mode ?? 'cors' };
    const respondWith = vi.fn();
    listeners.fetch!({ request, respondWith });
    return respondWith;
  }
  async function lifecycle(name: string) {
    const waitUntil = vi.fn(); listeners[name]!({ waitUntil });
    await waitUntil.mock.calls[0]![0];
  }
  return { request, lifecycle, entries, cache, caches, fetch, self };
}

it.each([
  ['/api/health', {}], ['/api/v1/observations', { method: 'POST' }],
  ['/api/health', { mode: 'navigate' }], ['/api', { mode: 'navigate' }],
  ['/__/auth/handler', { mode: 'navigate' }], ['/__', { mode: 'navigate' }],
  ['https://firestore.googleapis.com/data', {}], ['https://identitytoolkit.googleapis.com/auth', {}],
  ['https://example.org/assets/index-Abcd_123.js', {}],
  ['https://accounts.google.com/', { mode: 'navigate' }],
  ['/student', { method: 'POST', mode: 'navigate' }],
  ['/assets/plain.js', {}], ['/assets/index-abcdefgh.js?private=1', {}], ['/favicon.svg', {}],
])('does not intercept %s %j', (path, options) => {
  const sw = worker();
  expect(sw.request(path, options)).not.toHaveBeenCalled();
  expect(sw.fetch).not.toHaveBeenCalled(); expect(sw.caches.open).not.toHaveBeenCalled();
});

it('always tries the network for navigation and falls back to the static shell only offline', async () => {
  const sw = worker();
  sw.entries.set('/index.html', new Response('old'));
  expect(await (await sw.request('/student', { mode: 'navigate' }).mock.calls[0]![0]).text()).toContain('current');
  expect(sw.fetch).toHaveBeenCalledWith(expect.anything(), { cache: 'no-cache' });
  sw.fetch.mockRejectedValue(new TypeError('offline'));
  expect(await (await sw.request('/student', { mode: 'navigate' }).mock.calls[0]![0]).text()).toContain('current');
});

it('does not replace a saved shell with an HTTP error or non-HTML response', async () => {
  const sw = worker(); sw.entries.set('/index.html', new Response('saved'));
  for (const response of [new Response('error', { status: 503 }), new Response('{}', { headers: { 'content-type': 'application/json' } })]) {
    sw.fetch.mockResolvedValue(response);
    await sw.request('/student', { mode: 'navigate' }).mock.calls[0]![0];
  }
  expect(sw.cache.put).not.toHaveBeenCalled();
});

it('serves successful fingerprinted assets from cache, without caching a failed response', async () => {
  const sw = worker(); sw.fetch.mockResolvedValue(new Response('code'));
  const asset = '/assets/index-Abcd_123.js';
  await sw.request(asset).mock.calls[0]![0];
  sw.fetch.mockRejectedValue(new TypeError('offline'));
  expect(await (await sw.request(asset).mock.calls[0]![0]).text()).toBe('code');
  expect(sw.fetch).toHaveBeenCalledTimes(1);
  sw.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
  await sw.request('/assets/missing-Abcd_123.css').mock.calls[0]![0];
  expect(sw.cache.put).toHaveBeenCalledTimes(1);
});

it('activates immediately, removing only obsolete ToDoku caches', async () => {
  const sw = worker(); await sw.lifecycle('install'); await sw.lifecycle('activate');
  expect(sw.self.skipWaiting).toHaveBeenCalledOnce();
  expect(sw.caches.delete.mock.calls).toEqual([['todoku-pwa-old']]);
  expect(sw.self.clients.claim).toHaveBeenCalledOnce();
});

it('keeps the manifest and browser theme aligned with the app tokens', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const tokens = readFileSync(new URL('../src/shared/styles/tokens.css', import.meta.url), 'utf8').split('.app {')[1]!;
  expect(manifest.theme_color).toBe(tokens.match(/--ink: (#[0-9a-f]+);/)![1]);
  expect(manifest.background_color).toBe(tokens.match(/--paper: (#[0-9a-f]+);/)![1]);
  expect(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).toContain(`name="theme-color" content="${manifest.theme_color}"`);
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it.each([
  [false, undefined, false], [true, 'true', false], [true, undefined, true],
])('registers only a production, non-emulator build (PROD=%s emulator=%s)', async (production, emulator, expected) => {
  const register = vi.fn(async () => ({}));
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  vi.stubEnv('PROD', production); vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', emulator);
  const { registerPwa } = await import('../src/shared/pwa'); registerPwa();
  expect(register).toHaveBeenCalledTimes(expected ? 1 : 0);
  if (expected) expect(register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
});
