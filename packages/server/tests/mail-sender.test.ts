import { describe, expect, it, vi } from 'vitest';
import { createMailSender } from '../src/notifications/mail-sender.js';

const address = (name: string) => `${name}@example.invalid`;
const message = { to: address('student'), subject: '今日の課題', text: '架空の本文', html: '<p>架空の本文</p>' };
function setup(replies: (Response | Error)[]) {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('unexpected-call');
    return reply;
  });
  const sender = createMailSender({ from: address('sender'), clientId: 'dummy-client', clientSecret: 'dummy-secret',
    refreshToken: 'dummy-refresh', fetch: fetcher });
  return { sender, fetcher };
}
const token = () => Response.json({ access_token: 'dummy-access', expires_in: 3600, token_type: 'Bearer' });

describe('A1 Gmail sender without POST retries', () => {
  it('uses the fixed sender and one recipient, with encoded MIME and no CC/BCC', async () => {
    const { sender, fetcher } = setup([token(), Response.json({ id: 'fictional-message' })]);
    expect(await sender.check()).toBe('ready');
    expect(await sender.send(message)).toEqual({ state: 'accepted' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('dummy-refresh');
    expect(fetcher.mock.calls[1]![0]).toBe(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(address('sender'))}/messages/send`);
    const mime = Buffer.from(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).raw, 'base64url').toString();
    expect(mime).toContain(`From: ToDoku <${address('sender')}>\r\nTo: ${message.to}\r\n`);
    expect(mime).not.toMatch(/^(Cc|Bcc):/im);
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain(Buffer.from(message.text).toString('base64'));
    expect(mime).not.toContain('dummy-');
  });
  it.each([
    [401, 'failed', 'unauthorized'], [403, 'failed', 'forbidden'],
    [429, 'failed', 'rate-limited'], [500, 'unknown', 'server-error'], [503, 'unknown', 'server-error'],
  ])('classifies Gmail HTTP %s without resending', async (status, state, reason) => {
    const { sender, fetcher } = setup([token(), Response.json({ error: { message: 'must-not-escape' } }, { status: Number(status) })]);
    const result = await sender.send(message);
    expect(result).toMatchObject({ state, reason });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (status === 401 || status === 403) expect(await sender.check()).toBe('authorization-required');
  });
  it('treats a 403 rate limit as non-acceptance, without asking for authorization', async () => {
    const { sender } = setup([token(), Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, { status: 403 })]);
    expect(await sender.send(message)).toMatchObject({ state: 'failed', errorCode: 'not-accepted', reason: 'rate-limited' });
    expect(await sender.check()).toBe('ready');
  });
  it.each([new Error('private-transport-detail'), new SyntaxError('private-json-detail')])('marks lost or malformed acceptance as unknown', async error => {
    const { sender, fetcher } = setup([token(), error]);
    expect(await sender.send(message)).toMatchObject({ state: 'unknown', reason: 'response-lost' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('requires an acceptance id, not just a 200 response', async () => {
    const { sender } = setup([token(), Response.json({})]);
    expect(await sender.send(message)).toMatchObject({ state: 'unknown' });
  });
  it('handles sender revocation before the send and never calls Gmail', async () => {
    const { sender, fetcher } = setup([Response.json({ error: 'invalid_grant', error_description: 'private' }, { status: 400 })]);
    expect(await sender.send(message)).toEqual({ state: 'failed', errorCode: 'authorization-required', reason: 'source-revoked' });
    expect(await sender.check()).toBe('authorization-required');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500])('token HTTP %s never causes a Gmail request', async status => {
    const { sender, fetcher } = setup([Response.json({}, { status })]);
    expect(await sender.send(message)).toMatchObject({ state: 'failed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['other@example.invalid,third@example.invalid', 'x@example.invalid\r\nBcc: y@example.invalid'])('rejects address injection', async to => {
    const { sender, fetcher } = setup([]);
    expect(await sender.send({ ...message, to })).toMatchObject({ state: 'failed', reason: 'invalid-message' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
