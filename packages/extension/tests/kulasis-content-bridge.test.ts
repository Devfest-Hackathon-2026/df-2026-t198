import { afterEach, expect, it, vi } from 'vitest';
const start = vi.hoisted(() => vi.fn());
const collect = vi.hoisted(() => vi.fn());
vi.mock('../src/kulms-content.js', () => ({ startKyotoContent: start }));
vi.mock('../src/kulasis-collection.js', () => ({ collectKulasisObservation: collect }));
afterEach(() => vi.unstubAllGlobals());

it.each([undefined, { ok: false }, { ok: true }])('propagates an unsuccessful mapping message: %s', async reply => {
  vi.resetModules(); start.mockClear();
  vi.stubGlobal('window', { location: { origin: 'https://www.k.kyoto-u.ac.jp', href: 'https://www.k.kyoto-u.ac.jp/student/la/top' } });
  vi.stubGlobal('document', {});
  const send = vi.fn().mockResolvedValue(reply);
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } });
  collect.mockImplementation(async options => options.resolveSite('fictional-code'));
  await import('../src/kulasis-content.js');
  const run = start.mock.calls[0]![4] as (options: object) => Promise<unknown>;
  await expect(run({})).rejects.toThrow('detail-unavailable');
  send.mockResolvedValue({ ok: true, siteId: 'fictional-site' });
  await expect(run({})).resolves.toBe('fictional-site');
});
