/* global self, caches, fetch, URL */
const CACHE_PREFIX = 'todoku-pwa-';
const CACHE = `${CACHE_PREFIX}__BUILD_VERSION__`;
const SHELL = '/index.html';
const ASSET = /^\/assets\/[\w-]+-[\w-]{8,}\.(?:js|css)$/;

async function save(cache, key, response) {
  if (response.ok && !response.redirected) await cache.put(key, response.clone());
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(SHELL, { cache: 'no-cache' });
    if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('pwa-shell-unavailable');
    }
    const html = await response.clone().text();
    await cache.put(SHELL, response);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)]
      .map(match => match[1]).filter(path => ASSET.test(path));
    await Promise.all(assets.map(async path => save(cache, path, await fetch(path))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.headers.get('content-type')?.includes('text/html')) {
      await save(cache, SHELL, response).catch(() => {});
    }
    return response;
  } catch (error) {
    const shell = await cache.match(SHELL);
    if (shell) return shell;
    throw error;
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  // Fingerprinted static files have identical bytes across CORS request variants.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  await save(cache, request, response).catch(() => {});
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      /^\/(?:api|__)(?:\/|$)/.test(url.pathname)) return;
  if (request.mode === 'navigate') event.respondWith(navigate(request));
  else if (!url.search && ASSET.test(url.pathname)) event.respondWith(asset(request));
});
