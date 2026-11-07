import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSchedulerVerifier } from '../src/notification-auth.js';
import { createHttpServer } from '../src/http.js';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const rotatedPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedKey = { ...rotatedPair.publicKey.export({ format: 'jwk' }), kid: 'rotated-key', alg: 'RS256', use: 'sig' };
const audience = 'https://notifications.example.invalid/api/internal/notifications/tick';
const serviceAccount = ['scheduler', 'fictional.iam.gserviceaccount.com'].join('@');
const now = new Date('2030-11-11T00:00:00Z'), seconds = now.getTime() / 1000;
function token(patch: Record<string, unknown> = {}, header: Record<string, unknown> = {}, privateKey = pair.privateKey) {
  const encoded = [ { alg: 'RS256', kid: key.kid, ...header },
    { iss: 'https://accounts.google.com', aud: audience, sub: '123456789', email: serviceAccount,
      email_verified: true, exp: seconds + 3600, iat: seconds, ...patch } ].map(x => Buffer.from(JSON.stringify(x)).toString('base64url'));
  const input = encoded.join('.');
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
describe('Scheduler OIDC signature and claims', () => {
  const keys = vi.fn<typeof fetch>();
  beforeEach(() => { keys.mockReset(); keys.mockImplementation(async () => new Response(JSON.stringify({ keys: [key] }), { headers: { 'cache-control': 'max-age=300' } })); });
  const verifier = () => createSchedulerVerifier(audience, serviceAccount, keys, () => now);
  it('verifies a signed allowed identity, caches Google keys, and rejects a forged signature', async () => {
    const verify = verifier(); await verify(token()); await verify(token());
    expect(keys).toHaveBeenCalledTimes(1);
    const signed = token();
    await expect(verify(signed.slice(0, signed.lastIndexOf('.') + 1) + 'AAAA')).rejects.toThrow();
    expect(keys.mock.calls[0]![0]).toBe('https://www.googleapis.com/oauth2/v3/certs');
  });
  it.each([
    { iss: 'https://securetoken.google.com/fictional-project' }, { iss: 'https://attacker.example.invalid' },
    { aud: 'other-audience' }, { aud: [audience] }, { email: 'other-service-account' },
    { email_verified: false }, { sub: '' }, { exp: seconds }, { iat: seconds + 600 }, { exp: seconds + 7200 },
  ])('rejects disallowed claims (%#)', async patch => {
    await expect(verifier()(token(patch))).rejects.toThrow();
  });
  it.each([30, 60])('allows iat %i seconds ahead without extending exp', async ahead => {
    const verify = verifier();
    await expect(verify(token({ iat: seconds + ahead }))).resolves.toBeUndefined();
    await expect(verify(token({ iat: seconds - 3600, exp: seconds }))).rejects.toThrow();
  });
  it('rejects iat beyond the 60-second tolerance', async () => {
    await expect(verifier()(token({ iat: seconds + 61 }))).rejects.toThrow();
  });
  it('refreshes a cached key set when Google rotates to a new kid', async () => {
    const verify = verifier();
    await verify(token());
    keys.mockResolvedValueOnce(new Response(JSON.stringify({ keys: [rotatedKey] }),
      { headers: { 'cache-control': 'max-age=300' } }));
    await expect(verify(token({}, { kid: rotatedKey.kid }, rotatedPair.privateKey))).resolves.toBeUndefined();
    await verify(token({}, { kid: rotatedKey.kid }, rotatedPair.privateKey));
    expect(keys).toHaveBeenCalledTimes(2);
  });
  it('limits unknown-kid refreshes to once per minute across different kids', async () => {
    let time = now.getTime();
    const verify = createSchedulerVerifier(audience, serviceAccount, keys, () => new Date(time));
    await verify(token());
    for (const kid of ['missing-a', 'missing-b', 'missing-c']) {
      await expect(verify(token({}, { kid }))).rejects.toThrow();
    }
    expect(keys).toHaveBeenCalledTimes(2);
    time += 59_999;
    await expect(verify(token({}, { kid: 'missing-d' }))).rejects.toThrow();
    expect(keys).toHaveBeenCalledTimes(2);
    time += 1;
    await expect(verify(token({}, { kid: 'missing-e' }))).rejects.toThrow();
    expect(keys).toHaveBeenCalledTimes(3);
    await verify(token());
  });
  it('shares an in-flight rotation refresh across concurrent verification requests', async () => {
    const verify = verifier();
    await verify(token());
    let finish!: (response: Response) => void;
    keys.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const rotated = token({}, { kid: rotatedKey.kid }, rotatedPair.privateKey);
    const pending = Promise.allSettled([verify(rotated), verify(rotated), verify(rotated)]);
    expect(keys).toHaveBeenCalledTimes(2);
    finish(new Response(JSON.stringify({ keys: [rotatedKey] }),
      { headers: { 'cache-control': 'max-age=300' } }));
    expect(await pending).toEqual(Array.from({ length: 3 }, () => ({ status: 'fulfilled', value: undefined })));
    expect(keys).toHaveBeenCalledTimes(2);
  });
  it('rate-limits failed refreshes while retaining trusted cached keys and allowing later recovery', async () => {
    let time = now.getTime();
    const verify = createSchedulerVerifier(audience, serviceAccount, keys, () => new Date(time));
    await verify(token());
    keys.mockRejectedValueOnce(new Error('synthetic-network-failure'));
    await expect(verify(token({}, { kid: 'rotated-key' }))).rejects.toThrow();
    await expect(verify(token({}, { kid: 'other-missing-key' }))).rejects.toThrow();
    await verify(token());
    expect(keys).toHaveBeenCalledTimes(2);
    time += 60_000;
    keys.mockResolvedValueOnce(new Response(JSON.stringify({ keys: [rotatedKey] }),
      { headers: { 'cache-control': 'max-age=300' } }));
    await expect(verify(token({}, { kid: rotatedKey.kid }, rotatedPair.privateKey))).resolves.toBeUndefined();
    expect(keys).toHaveBeenCalledTimes(3);
  });
  it('rejects alg confusion, missing key IDs and inaccessible or untrusted keys', async () => {
    for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { kid: 'not-google-key' }, { crit: ['unhandled'] }]) {
      await expect(verifier()(token({}, header))).rejects.toThrow();
    }
    keys.mockResolvedValue(new Response('', { status: 500 }));
    await expect(verifier()(token())).rejects.toThrow();
  });
});

describe('dedicated HTTP entrance', () => {
  let server: ReturnType<typeof createHttpServer>, base: string;
  const tick = vi.fn(async () => ({ dryRun: true, candidates: 0, attempted: 0 }));
  beforeEach(async () => {
    tick.mockClear();
    const keys: typeof fetch = async () => new Response(JSON.stringify({ keys: [key] }));
    server = createHttpServer({ verifyToken: async () => 'ordinary-user', saveObservation: vi.fn(),
      notifications: { verify: createSchedulerVerifier(audience, serviceAccount, keys, () => now), tick } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const request = (headers: Record<string, string>, suffix = '', body?: string) => fetch(`${base}/api/internal/notifications/tick${suffix}`,
    { method: 'POST', headers, ...(body ? { body } : {}) });
  it('rejects no auth, forged scheduler headers and ordinary Firebase credentials', async () => {
    for (const headers of [{}, { 'X-CloudScheduler': 'true' }, { Authorization: 'Bearer ordinary-firebase-user' }]) {
      expect((await request(headers)).status).toBe(401);
    }
    expect(tick).not.toHaveBeenCalled();
  });
  it('accepts only body-free ticks and awaits execution before responding', async () => {
    const headers = { Authorization: `Bearer ${token()}` };
    expect((await request(headers, '?uid=other')).status).toBe(400);
    expect((await request(headers, '', '{}')).status).toBe(400);
    let finish!: () => void;
    tick.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); return { dryRun: true, candidates: 1, attempted: 0 }; });
    let completed = false;
    const pending = request(headers).then(r => { completed = true; return r; });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(completed).toBe(false); finish();
    const response = await pending;
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ dryRun: true, candidates: 1, attempted: 0 });
  });
  it('returns a fixed error without upstream details and leaves the existing health route working', async () => {
    tick.mockRejectedValueOnce(new Error('private-upstream-details'));
    const response = await request({ Authorization: `Bearer ${token()}` });
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('private-upstream');
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
