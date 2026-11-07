import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/calendar-browser.js', () => ({ startCalendarSync: () => {}, handleCalendarMessage: () => undefined }));
vi.mock('../src/auth-probe-worker.js', () => ({ handleAuthProbeMessage: () => undefined }));
const runCollection = vi.hoisted(() => vi.fn());
vi.mock('../src/collection-worker.js', () => ({ runCollection, yieldCollection: async () => ({ ok: true }) }));

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: { ok: boolean }) => void,
) => boolean | undefined;

let listener: Listener;
const setSession = vi.fn<() => Promise<void>>();
const message = { type: 'ynu-session-found', sid: 'synthetic-session' };
const tab = { id: 7 } as chrome.tabs.Tab;
const sender: chrome.runtime.MessageSender = {
  id: 'test-extension',
  url: 'https://lms.ynu.ac.jp/lms/home;SID=synthetic-session',
  frameId: 0,
};

beforeEach(async () => {
  vi.resetModules();
  runCollection.mockReset().mockResolvedValue({ ok: true, changed: false, changeCount: 0 });
  setSession.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: (callback: Listener) => { listener = callback; } },
    },
    storage: { session: { set: setSession } },
  });
  await import('../src/service-worker.js');
});

afterEach(() => vi.unstubAllGlobals());

describe('service worker session handoff', () => {
  it.each([
    '/lms/homeHoml/;SID=synthetic-session',
    '/lms/homeHoml/doIndex;SID=synthetic-session',
    '/lms/homeHoml;SID=synthetic-session/',
  ])('starts automatic collection after saving the SID on a home page: %s', async path => {
    const respond = vi.fn();
    const homeSender = { ...sender, url: `https://lms.ynu.ac.jp${path}`, tab, documentId: 'synthetic-document' };
    expect(listener(message, homeSender, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, changed: false, changeCount: 0 }));
    expect(setSession).toHaveBeenCalledExactlyOnceWith({ ynuSessionId: 'synthetic-session' });
    expect(runCollection).toHaveBeenCalledExactlyOnceWith(homeSender.url, 7, 'synthetic-document');
    expect(setSession.mock.invocationCallOrder[0]).toBeLessThan(runCollection.mock.invocationCallOrder[0]!);
  });

  it.each([
    '/lms/corsColl/doIndex;SID=synthetic-session',
    '/lms/grades/view;SID=synthetic-session',
    '/lms/corsColl/linkKyozaiTitle;SID=synthetic-session',
    '/lms/homeHoml/linkKougi;SID=synthetic-session',
    '/lms/homeHoml/doIndexExtra;SID=synthetic-session',
    '/lms/homeHoml/doIndex/;SID=synthetic-session',
  ])('stores and acknowledges the SID without collecting on another page: %s', async path => {
    const respond = vi.fn();
    expect(listener(message, { ...sender, url: `https://lms.ynu.ac.jp${path}`, tab }, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(runCollection).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledExactlyOnceWith({ ynuSessionId: 'synthetic-session' });
    expect(respond).toHaveBeenCalledExactlyOnceWith({ ok: true });
  });

  it('stores only the session ID in memory and acknowledges after saving', async () => {
    const respond = vi.fn();
    expect(listener(message, sender, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }));
    expect(setSession).toHaveBeenCalledExactlyOnceWith({ ynuSessionId: 'synthetic-session' });
  });

  it.each([
    { ...sender, id: 'other-extension' },
    { ...sender, url: 'https://example.org/home;SID=synthetic-session' },
    { ...sender, url: 'https://lms.ynu.ac.jp/lms/home;SID=different-session' },
    { ...sender, url: 'https://lms.ynu.ac.jp/lms/login' },
    { ...sender, frameId: 1 },
    {},
  ])('rejects an untrusted sender without storing anything', (untrustedSender) => {
    const respond = vi.fn();
    expect(listener(message, untrustedSender, respond)).not.toBe(true);
    expect(setSession).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ ok: false });
  });

  it('rejects a malformed message', () => {
    const respond = vi.fn();
    listener({ type: 'ynu-session-found', sid: 42 }, sender, respond);
    expect(setSession).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ ok: false });
  });

  it('reports a storage error without returning the error or SID', async () => {
    setSession.mockRejectedValue(new Error('synthetic private error'));
    const respond = vi.fn();
    expect(listener(message, sender, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: false }));
  });
});
