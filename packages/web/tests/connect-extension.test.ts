import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { askExtension, EXTENSION_ID } from '../src/features/connect/extension';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('addresses the extension whose ID follows from the committed manifest key', () => {
  const { key } = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8')) as { key: string };
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  expect(EXTENSION_ID).toBe([...digest].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join(''));
});

it('reports no extension on a phone, in another browser, or when Chrome cannot deliver the message', async () => {
  expect(await askExtension('todoku-status', 'student')).toBeNull();
  vi.stubGlobal('chrome', {});
  expect(await askExtension('todoku-status', 'student')).toBeNull();
  vi.stubGlobal('chrome', { runtime: { lastError: { message: 'Could not establish connection.' },
    sendMessage: (_id: string, _message: unknown, callback: (reply: unknown) => void) => callback(undefined) } });
  expect(await askExtension('todoku-calendar-connect', 'student')).toBeNull();
  vi.stubGlobal('chrome', { runtime: { sendMessage: () => { throw new Error('synthetic'); } } });
  expect(await askExtension('todoku-calendar-sync', 'student')).toBeNull();
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { sendMessage: () => {} } });
  const silent = askExtension('todoku-status', 'student');
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await silent).toBeNull();
});

it('sends only the request type and the signed-in UID, and returns the fixed reply', async () => {
  const sendMessage = vi.fn((_id: string, _message: unknown, callback: (reply: unknown) => void) => callback({ ok: false, code: 'account-mismatch' }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  expect(await askExtension('todoku-calendar-connect', 'student')).toEqual({ ok: false, code: 'account-mismatch' });
  expect(sendMessage).toHaveBeenCalledWith(EXTENSION_ID, { type: 'todoku-calendar-connect', uid: 'student' }, expect.any(Function));
});
