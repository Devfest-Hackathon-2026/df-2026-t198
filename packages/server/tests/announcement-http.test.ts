import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpServer } from '../src/http.js';

const server = createHttpServer();
let base: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
it('keeps announcement intake unavailable by default with no cached response', async () => {
  const response = await fetch(`${base}/api/v1/announcements`, { method: 'POST',
    headers: { Authorization: 'Bearer fictional-credential', 'Content-Type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('requires authentication even when intake is disabled', async () => {
  const response = await fetch(`${base}/api/v1/announcements`, { method: 'POST', body: '{}' });
  expect(response.status).toBe(401);
});
