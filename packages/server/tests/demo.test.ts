import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';
import { DemoConflict, DemoForbidden } from '../src/demo-store.js';

const extend = vi.fn(async (_uid: string, sourceId: string) => ({ sourceId, dueAt: '2026-11-13T08:00:00.000Z' }));
const verifyToken = vi.fn(async () => 'demo-student');
const server = createHttpServer({ verifyToken,
  saveObservation: vi.fn(), demo: { extend, reset: vi.fn(), announce: vi.fn() } });
let url: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  url = `http://127.0.0.1:${address.port}/api/v1/demo/extend`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => vi.clearAllMocks());
const body = { sourceId: 'DEMO101_TASK1', expectedDueAt: '2026-11-12T08:00:00.000Z' };
const post = (value: unknown = body, headers = {}) => fetch(url, { method: 'POST', headers: {
  Authorization: 'Bearer unit-test-credential', 'Content-Type': 'application/json', ...headers,
}, body: JSON.stringify(value) });

it('extends only the verified owner and returns no-store', async () => {
  const response = await post();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(extend).toHaveBeenCalledWith('demo-student', body.sourceId, body.expectedDueAt);
});
it('requires authentication before reading a request', async () => {
  expect((await post(body, { Authorization: '' })).status).toBe(401);
  verifyToken.mockRejectedValueOnce(new Error('private-auth-detail'));
  expect((await post()).status).toBe(401);
  expect(extend).not.toHaveBeenCalled();
});
it('rejects ownership injection, invalid dates, paths, unknown keys and large bodies', async () => {
  for (const value of [{ ...body, studentId: 'other' }, { ...body, sourceId: '../other' },
    { ...body, expectedDueAt: '2026-02-30T08:00:00.000Z' }, { ...body, expectedDueAt: 'tomorrow' },
    { ...body, expectedDueAt: '2026-11-12T08:00:00' }, null]) {
    expect((await post(value)).status).toBe(400);
  }
  expect((await post(body, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await post('x'.repeat(3000))).status).toBe(413);
  expect(extend).not.toHaveBeenCalled();
});
it('reports forbidden, stale dates and internal failures without private details', async () => {
  for (const [error, status, code] of [[new DemoForbidden(), 403, 'forbidden'],
    [new DemoConflict(), 409, 'deadline-changed'], [new Error('private-store-detail'), 500, 'internal-error']] as const) {
    extend.mockRejectedValueOnce(error);
    const response = await post();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  }
});
