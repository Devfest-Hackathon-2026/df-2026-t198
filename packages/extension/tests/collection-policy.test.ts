import { afterEach, expect, it, vi } from 'vitest';
import { backgroundCollectionEnabled } from '../src/collection-policy.js';

afterEach(() => vi.unstubAllGlobals());

it('reads fresh policy without credentials and accepts only explicit enabled', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ backgroundCollection: 'enabled' }) });
  vi.stubGlobal('fetch', fetcher);
  expect(await backgroundCollectionEnabled('https://api.example.test')).toBe(true);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.example.test/api/v1/collection-policy', {
    method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
  });
});

it.each([null, [], {}, 'enabled', { backgroundCollection: true }, { backgroundCollection: 'paused' },
  { backgroundCollection: 'enabled', extra: 'unknown' }])('refuses an unrecognized or paused policy: %j', async policy => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => policy }));
  expect(await backgroundCollectionEnabled('https://api.example.test')).toBe(false);
});
