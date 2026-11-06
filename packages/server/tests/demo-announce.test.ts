import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';
import { DemoForbidden } from '../src/demo-store.js';

const announce = vi.fn(async () => ({ announcementId: 'fictional-notice' }));
const server = createHttpServer({ verifyToken: async () => 'demo-owner', saveObservation: vi.fn(),
  demo: { extend: vi.fn(), reset: vi.fn(), announce } });
let url: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  url = `http://127.0.0.1:${address.port}/api/v1/demo/announce`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const body = { sourceId: 'DEMO101_TASK1', expectedDueAt: '2026-11-12T08:00:00.000Z' };
const post = (value: unknown = body, headers = {}) => fetch(url, { method: 'POST', headers: {
  Authorization: 'Bearer unit-test-credential', 'Content-Type': 'application/json', ...headers,
}, body: JSON.stringify(value) });
it('publishes for the authenticated owner and returns no-store', async () => {
  const response = await post();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(announce).toHaveBeenCalledWith('demo-owner', body.sourceId, body.expectedDueAt);
});
it('rejects missing auth, owner injection, arbitrary body, invalid dates and oversized input', async () => {
  announce.mockClear();
  expect((await post(body, { Authorization: '' })).status).toBe(401);
  for (const value of [{ ...body, studentId: 'other' }, { ...body, body: 'arbitrary text' },
    { ...body, expectedDueAt: '2026-02-30T08:00:00.000Z' }, { ...body, sourceId: '../other' }, null]) {
    expect((await post(value)).status).toBe(400);
  }
  expect((await post('x'.repeat(3000))).status).toBe(413);
  expect((await post(body, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect(announce).not.toHaveBeenCalled();
  announce.mockRejectedValueOnce(new DemoForbidden());
  expect((await post()).status).toBe(403);
});
