import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';
import { DemoForbidden } from '../src/demo-store.js';

const reset = vi.fn(async () => ({ reset: true, data: { courses: [] } }));
const verifyToken = vi.fn(async () => 'trial-owner');
const server = createHttpServer({ verifyToken, saveObservation: vi.fn(), demo: {
  extend: vi.fn(), reset,
} });
let url: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  url = `http://127.0.0.1:${address.port}/api/v1/demo/reset`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const post = (body: unknown, headers = {}) => fetch(url, { method: 'POST', headers: {
  Authorization: 'Bearer unit-test-credential', 'Content-Type': 'application/json', ...headers,
}, body: JSON.stringify(body) });
it('resets only the verified owner, allowing an explicit freshness check', async () => {
  for (const onlyIfStale of [true, false]) {
    const response = await post({ onlyIfStale });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(reset).toHaveBeenLastCalledWith('trial-owner', onlyIfStale);
  }
});
it('rejects missing authentication, injected owners and malformed bodies', async () => {
  reset.mockClear();
  expect((await post({}, { Authorization: '' })).status).toBe(401);
  for (const body of [{}, { onlyIfStale: 'false' }, { onlyIfStale: false, studentId: 'other' }, null]) {
    expect((await post(body)).status).toBe(400);
  }
  expect((await post({ onlyIfStale: false }, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await post('x'.repeat(3000))).status).toBe(413);
  expect(reset).not.toHaveBeenCalled();
});
it('returns fixed forbidden and internal errors without store details', async () => {
  for (const [failure, status, error] of [[new DemoForbidden(), 403, 'forbidden'],
    [new Error('private-store-detail'), 500, 'internal-error']] as const) {
    reset.mockRejectedValueOnce(failure);
    const response = await post({ onlyIfStale: false });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  }
});
