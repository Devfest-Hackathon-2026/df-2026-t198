import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpServer, type ObservationDependencies } from '../src/http.js';

const servers: ReturnType<typeof createHttpServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function start() {
  const digest = { read: vi.fn(async () => ({ empty: true })), delivery: vi.fn(async () => ({ enabled: false, deliveryOwner: 'none' })), act: vi.fn(async () => ({ outcome: 'done' })) };
  const deps = { verifyToken: async () => 'student-a', verifyDigestToken: async (token: string) => {
    if (token === 'invalid') throw new Error('never-echo-this');
    return { uid: 'student-a', email: token === 'no-email' ? undefined : 'student@example.invalid' };
  }, digest, saveObservation: vi.fn() } as unknown as ObservationDependencies;
  const server = createHttpServer(deps); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  return { base: `http://127.0.0.1:${address.port}`, digest };
}
describe('self-only digest and plan actions', () => {
  it('requires verified identity and takes recipient only from the verified email', async () => {
    const { base, digest } = await start();
    for (const token of [null, 'invalid']) {
      const response = await fetch(`${base}/api/v1/digest?to=outsider@example.invalid`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
      expect(response.status).toBe(401); expect(await response.text()).not.toContain('never-echo-this');
    }
    const response = await fetch(`${base}/api/v1/digest?to=outsider@example.invalid`, { headers: { Authorization: 'Bearer valid' } });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(digest.read).toHaveBeenCalledExactlyOnceWith('student-a', 'student@example.invalid');
    expect((await fetch(`${base}/api/v1/digest`, { headers: { Authorization: 'Bearer no-email' } })).status).toBe(403);
  });
  it('GET never performs an action; POST can only address the authenticated user', async () => {
    const { base, digest } = await start();
    const path = '/api/v1/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/done';
    expect((await fetch(base + path)).status).toBe(404);
    expect((await fetch(base + path, { method: 'POST' })).status).toBe(401);
    expect((await fetch(base + path + '?rev=1', { method: 'POST', headers: { Authorization: 'Bearer valid' } })).status).toBe(200);
    expect(digest.act).toHaveBeenCalledExactlyOnceWith('student-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'done', 1);
    expect((await fetch(`${base}/api/v1/plans/not-an-id/later`, { method: 'POST', headers: { Authorization: 'Bearer valid' } })).status).toBe(400);
    expect((await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer valid' }, body: JSON.stringify({ uid: 'other' }) })).status).toBe(400);
    for (const suffix of ['', '?rev=0', '?rev=-1', '?rev=1.5', '?rev=NaN', '?rev=9007199254740992', '?rev=1&rev=2']) {
      expect((await fetch(base + path + suffix, { method: 'POST', headers: { Authorization: 'Bearer valid' } })).status).toBe(400);
    }
    expect(digest.act).toHaveBeenCalledTimes(1);
  });
});

it('authenticates delivery checks and demo previews and ignores a requested owner', async () => {
  const { base, digest } = await start();
  for (const route of ['delivery', 'demo-preview']) {
    for (const token of [undefined, 'invalid']) {
      const response = await fetch(`${base}/api/v1/digest/${route}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
      expect(response.status).toBe(401);
    }
    const response = await fetch(`${base}/api/v1/digest/${route}?uid=other`, { headers: { Authorization: 'Bearer valid' } });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  }
  expect(digest.delivery).toHaveBeenCalledExactlyOnceWith('student-a');
  expect(digest.read).toHaveBeenCalledExactlyOnceWith('student-a', 'student@example.invalid', true);
  expect(digest.act).not.toHaveBeenCalled();
});
