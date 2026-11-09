import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';

const sharing = {
  list: vi.fn(async () => ({ supporters: [{ uid: 'supporter-a', revoked: false }], canManage: true })),
  change: vi.fn(async () => {}),
};
const verifyToken = vi.fn(async () => 'student-a');
const dependencies = { verifyToken, saveObservation: vi.fn(), sharing };
const server = createHttpServer(dependencies);
let base: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  base = `http://127.0.0.1:${address.port}/api/v1/sharing/supporters`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });
const authorization = 'Bearer fictional-test';
const post = (id = 'supporter-a', action = 'revoke', body?: string) => fetch(`${base}/${id}/${action}`, {
  method: 'POST', headers: { authorization }, ...(body ? { body } : {}),
});
it('uses only the verified student identity, including when a query names another student', async () => {
  const result = await fetch(`${base}/supporter-a/revoke?studentId=other`, { method: 'POST', headers: { authorization } });
  expect(result.status).toBe(200);
  expect(sharing.change).toHaveBeenCalledExactlyOnceWith('student-a', 'supporter-a', true);
  expect(result.headers.get('cache-control')).toBe('no-store');
});
it('requires authentication for listing and changing grants', async () => {
  expect((await fetch(base)).status).toBe(401);
  expect((await fetch(`${base}/supporter-a/revoke`, { method: 'POST' })).status).toBe(401);
  verifyToken.mockRejectedValueOnce(new Error('private-identity-error'));
  expect((await post()).status).toBe(401);
  expect(sharing.change).not.toHaveBeenCalled();
  expect(sharing.list).not.toHaveBeenCalled();
});
it('lists existing grants and restores through the same authenticated identity', async () => {
  const response = await fetch(base, { headers: { authorization } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ supporters: [{ uid: 'supporter-a', revoked: false }], canManage: true });
  expect(sharing.list).toHaveBeenCalledExactlyOnceWith('student-a');
  expect((await post('supporter-a', 'restore')).status).toBe(200);
  expect(sharing.change).toHaveBeenCalledExactlyOnceWith('student-a', 'supporter-a', false);
});
it('rejects encoded separators and identity fields in the body', async () => {
  for (const id of ['a%2Fb', '%00', '%E0%A4']) expect((await post(id)).status).toBe(400);
  // fetch normalizes encoded dot segments before sending the request.
  expect((await post('%2E%2E')).status).toBe(404);
  expect((await post('supporter-a', 'revoke', '{"studentId":"other"}')).status).toBe(400);
  expect(sharing.change).not.toHaveBeenCalled();
});
it('masks storage failures', async () => {
  sharing.change.mockRejectedValueOnce(new Error('private-storage-error'));
  const result = await post();
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({ error: 'internal-error' });
});
