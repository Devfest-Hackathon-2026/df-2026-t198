import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';
import { SessionForbidden } from '../src/session-store.js';
import { parseSessionContext } from '../src/session-input.js';

const session = {
  listStudents: vi.fn(async () => [{ uid: 'student-a' }]),
  saveContext: vi.fn(async () => {}),
};
const verifyToken = vi.fn(async () => 'supporter-a');
const server = createHttpServer({ verifyToken, saveObservation: vi.fn(), session });
let base: string;
const context = { lastSessionAt: '2026-11-01T10:00:00+09:00', nextSessionAt: '2026-11-13T11:00:00+09:00' };
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });
function put(body: unknown, authorization = 'Bearer fictional-test') {
  return fetch(`${base}/api/v1/students/student-a/session-context`, { method: 'PUT',
    headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
it('requires authentication before listing students or saving context', async () => {
  expect((await fetch(`${base}/api/v1/supporter/students`)).status).toBe(401);
  expect((await put(context, '')).status).toBe(401);
  expect(session.listStudents).not.toHaveBeenCalled();
  expect(session.saveContext).not.toHaveBeenCalled();
});
it('lists only through the verified supporter identity, without caching', async () => {
  const result = await fetch(`${base}/api/v1/supporter/students?uid=someone-else`, {
    headers: { authorization: 'Bearer fictional-test' },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ students: [{ uid: 'student-a' }] });
  expect(session.listStudents).toHaveBeenCalledExactlyOnceWith('supporter-a');
  expect(result.headers.get('cache-control')).toBe('no-store');
});
it('checks the supporter grant on writes and returns a fixed denial', async () => {
  session.saveContext.mockRejectedValueOnce(new SessionForbidden());
  const response = await put(context);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'forbidden' });
  expect(session.saveContext).toHaveBeenCalledExactlyOnceWith('supporter-a', 'student-a', context);
});
it('accepts null dates and rejects extra fields, timezone-less or impossible dates', async () => {
  expect(parseSessionContext({ lastSessionAt: null, nextSessionAt: null })).toEqual({ lastSessionAt: null, nextSessionAt: null });
  for (const body of [null, [], {}, { ...context, uid: 'other' },
    { ...context, nextSessionAt: '2026-02-30T10:00:00Z' },
    { ...context, nextSessionAt: '2026-11-13T11:00:00' },
    { ...context, nextSessionAt: '2026-11-13T24:00:00Z' },
    { ...context, nextSessionAt: '2026-11-13T11:00:00+25:00' },
    { ...context, lastSessionAt: ['2026-11-01T10:00:00Z'] }]) {
    expect((await put(body)).status).toBe(400);
  }
  expect(session.saveContext).not.toHaveBeenCalled();
});
it('persists the exact approved fields and masks unexpected storage failures', async () => {
  expect((await put(context)).status).toBe(200);
  session.saveContext.mockRejectedValueOnce(new Error('private upstream contents'));
  const failed = await put(context);
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain('private');
});
it('bounds the input body and requires JSON', async () => {
  expect((await put({ ...context, extra: 'x'.repeat(3000) })).status).toBe(413);
  expect((await fetch(`${base}/api/v1/students/student-a/session-context`, {
    method: 'PUT', headers: { authorization: 'Bearer fictional-test' }, body: 'text',
  })).status).toBe(415);
});

it('rejects failed token verification before querying permissions', async () => {
  verifyToken.mockRejectedValueOnce(new Error('private-identity-error'));
  const result = await put(context);
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: 'unauthorized' });
  expect(session.saveContext).not.toHaveBeenCalled();
});
it('rejects an encoded path separator instead of writing another student path', async () => {
  const result = await fetch(`${base}/api/v1/students/student-a%2Fother/session-context`, {
    method: 'PUT', headers: { authorization: 'Bearer fictional-test', 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  });
  expect(result.status).toBe(400); expect(session.saveContext).not.toHaveBeenCalled();
});
