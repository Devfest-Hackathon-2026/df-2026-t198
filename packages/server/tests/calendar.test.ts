import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';

const calendar = { pending: vi.fn(async () => ({ integration: null, items: [] })), connect: vi.fn(async () => {}), report: vi.fn(async () => {}) };
const verifyToken = vi.fn(async () => 'owner');
const server = createHttpServer({ verifyToken, saveObservation: vi.fn(), calendar });
let url: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  url = `http://127.0.0.1:${address.port}/api/v1/calendar-sync`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => vi.clearAllMocks());
function post(body: unknown) { return fetch(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
const report = { itemKey: 'a'.repeat(64), eventId: 'abcde', generation: 1, revision: 1, errorCode: null };
it('authenticates GET and both POST forms and uses only the verified owner', async () => {
  const result = await fetch(url, { headers: { Authorization: 'Bearer synthetic-token' } });
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(calendar.pending).toHaveBeenCalledWith('owner');
  expect((await post(report)).status).toBe(200); expect(calendar.report).toHaveBeenCalledWith('owner', report);
  expect((await post({ calendarId: 'synthetic@group.calendar.google.com' })).status).toBe(200);
  expect(calendar.connect).toHaveBeenCalledWith('owner', 'synthetic@group.calendar.google.com');
});
it('rejects missing or invalid credentials without calling the store', async () => {
  expect((await fetch(url)).status).toBe(401);
  verifyToken.mockRejectedValueOnce(new Error('private token error'));
  const result = await post(report); expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: 'unauthorized' });
  expect(calendar.report).not.toHaveBeenCalled();
});
it.each([
  { ...report, uid: 'other' }, { ...report, errorCode: 'raw private error' }, { ...report, itemKey: '../other' },
  { ...report, revision: -1 }, { ...report, generation: 0 }, { ...report, eventId: '/escape' },
  { calendarId: 'primary' }, { calendarId: 'synthetic@group.calendar.google.com', access_token: 'synthetic' },
])('rejects unexpected fields, unsafe keys and invalid reports (%#)', async body => {
  expect((await post(body)).status).toBe(400); expect(calendar.report).not.toHaveBeenCalled(); expect(calendar.connect).not.toHaveBeenCalled();
});
it('bounds JSON and never leaks SDK error details', async () => {
  expect((await post('x'.repeat(4097))).status).toBe(413);
  expect((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  calendar.report.mockRejectedValueOnce(new Error('private upstream text'));
  const result = await post(report); expect(result.status).toBe(500);
  expect(await result.json()).toEqual({ error: 'internal-error' });
});
