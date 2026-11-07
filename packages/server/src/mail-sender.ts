import { randomUUID } from 'node:crypto';
import { isSafeMailText } from '@kadai-hisho/core';
import type { NotificationSender } from './notification-dispatch.js';

export type SenderState = 'preparing' | 'ready' | 'authorization-required';
type FailureReason = 'unauthorized' | 'forbidden' | 'rate-limited' | 'server-error' |
  'response-lost' | 'source-revoked' | 'token-error' | 'invalid-message';
type SendResult = Awaited<ReturnType<NotificationSender['send']>> & { reason?: FailureReason };
interface MailOptions { from: string; clientId: string; clientSecret: string; refreshToken: string; fetch?: typeof fetch }
export const singleMailbox = (value: string) => value.length <= 254 &&
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(value);
const base64Lines = (text: string) => Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';

/** Credentials are supplied by Cloud Run's pinned Secret Manager environment bindings. */
export function createMailSender(options: MailOptions) {
  const fetcher = options.fetch ?? fetch;
  let access: { value: string; until: number } | undefined;
  let revoked = false;
  async function authorize(): Promise<string | null> {
    if (revoked) return null;
    if (access && access.until > Date.now()) return access.value;
    try {
      const response = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: options.clientId,
          client_secret: options.clientSecret, refresh_token: options.refreshToken }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (body['error'] === 'invalid_grant' || body['error'] === 'invalid_client' || response.status === 401 || response.status === 403) revoked = true;
      if (!response.ok || typeof body['access_token'] !== 'string' || !body['access_token'] ||
        /\s/.test(body['access_token']) || typeof body['expires_in'] !== 'number' || body['expires_in'] <= 60 || body['token_type'] !== 'Bearer') return null;
      access = { value: body['access_token'], until: Date.now() + (Math.min(body['expires_in'], 3600) - 60) * 1000 };
      return access.value;
    } catch { return null; }
  }
  const configured = singleMailbox(options.from) && !!options.clientId && !!options.clientSecret && !!options.refreshToken;
  return {
    async check(): Promise<SenderState> {
      if (!configured) return 'preparing';
      return await authorize() ? 'ready' : revoked ? 'authorization-required' : 'preparing';
    },
    async send(message: Parameters<NotificationSender['send']>[0]): Promise<SendResult> {
      if (!configured || !singleMailbox(message.to) || /[\r\n]/.test(message.subject) ||
        ![message.subject, message.text, message.html].every(value => isSafeMailText(value))) {
        return { state: 'failed', errorCode: 'not-accepted', reason: 'invalid-message' };
      }
      const token = await authorize();
      if (!token) return { state: 'failed', errorCode: revoked ? 'authorization-required' : 'not-accepted',
        reason: revoked ? 'source-revoked' : 'token-error' };
      const boundary = `notification-${randomUUID()}`;
      const subject = Array.from(message.subject).reduce<string[]>((parts, char) => {
        if (!parts.length || Buffer.byteLength(parts[parts.length - 1]! + char) > 42) parts.push(char);
        else parts[parts.length - 1] += char;
        return parts;
      }, []).map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
      const raw = [`From: ${options.from}`, `To: ${message.to}`, `Subject: ${subject}`, 'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        ...(['text/plain', 'text/html'] as const).flatMap((type, i) => [`--${boundary}`,
          `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(i ? message.html : message.text)]),
        `--${boundary}--`, ''].join('\r\n');
      try {
        const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(options.from)}/messages/send`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
        });
        if (response.status >= 500) return { state: 'unknown', reason: 'server-error' };
        if (response.status === 429) return { state: 'failed', errorCode: 'not-accepted', reason: 'rate-limited' };
        if (response.status === 401 || response.status === 403) {
          const body = await response.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } };
          const limited = body.error?.errors?.some(e => ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(e.reason ?? ''));
          if (limited) return { state: 'failed', errorCode: 'not-accepted', reason: 'rate-limited' };
          revoked = true; access = undefined;
          return { state: 'failed', errorCode: 'authorization-required', reason: response.status === 401 ? 'unauthorized' : 'forbidden' };
        }
        if (!response.ok) return { state: 'failed', errorCode: 'not-accepted', reason: 'invalid-message' };
        const body = await response.json() as { id?: unknown };
        return typeof body.id === 'string' && body.id ? { state: 'accepted' } : { state: 'unknown', reason: 'response-lost' };
      } catch { return { state: 'unknown', reason: 'response-lost' }; }
    },
  };
}

export function mailSenderFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const from = env['NOTIFICATION_FROM'], clientId = env['GMAIL_CLIENT_ID'],
    clientSecret = env['GMAIL_CLIENT_SECRET'], refreshToken = env['GMAIL_REFRESH_TOKEN'];
  return from && clientId && clientSecret && refreshToken ? createMailSender({ from, clientId, clientSecret, refreshToken }) : undefined;
}
