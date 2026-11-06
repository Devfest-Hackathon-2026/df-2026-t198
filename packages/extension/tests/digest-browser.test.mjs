import { afterEach, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

const state = vi.hoisted(() => ({ user: undefined, googleUid: 'owner' }));
const config = { apiOrigin: 'https://api.example.invalid', oauthClientId: '123-test.apps.googleusercontent.com', firebase: { projectId: 'synthetic' } };
vi.mock('../src/probe-config.js', () => ({ probeConfig: { apiOrigin: 'https://api.example.invalid', oauthClientId: '123-test.apps.googleusercontent.com', firebase: { projectId: 'synthetic' } }, missingConfig: () => [] }));
vi.mock('../src/auth-probe-browser.js', () => ({
  observationIdentity: async () => state.user && { uid: state.user.uid, token: 'synthetic-firebase-token' },
  firebaseAuth: () => ({ currentUser: state.user }),
  confirmGoogleIdentity: async (_token, uid) => state.googleUid === uid,
}));
const mail = { to: 'student@example.invalid', subject: '今日やること', text: '今日の準備。', html: '<p>今日の準備。</p>' };
const namespace = `${config.firebase.projectId}:${config.oauthClientId}`;
const receipts = `digestReceipt:${namespace}:owner`;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function fixture({ enabled = true, now = '2026-11-07T07:29:00+09:00' } = {}) {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
  state.user = { uid: 'owner', email: mail.to }; state.googleUid = 'owner';
  const data = enabled ? { digestPreference: { enabled: true, uid: 'owner', namespace } } : {};
  const alarms = new Map(); let startup; let installed; let onAlarm;
  const chrome = { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`,
    onStartup: { addListener: fn => { startup = fn; } }, onInstalled: { addListener: fn => { installed = fn; } } },
    alarms: { get: vi.fn(async name => alarms.get(name)), create: vi.fn(async (name, value) => alarms.set(name, { ...value, scheduledTime: value.when })),
      clear: vi.fn(async name => alarms.delete(name)), onAlarm: { addListener: fn => { onAlarm = fn; } } },
    identity: { getAuthToken: vi.fn(async () => ({ token: 'synthetic-google-token' })), removeCachedAuthToken: vi.fn() },
    storage: { session: { get: async () => ({ ynuSessionId: 'synthetic-lms-session' }) }, local: {
      get: vi.fn(async () => globalThis.structuredClone(data)), set: vi.fn(async value => Object.assign(data, globalThis.structuredClone(value))), setAccessLevel: vi.fn(async () => {}),
    } } };
  const digest = { ...mail, date: '2026-11-07', empty: false, plans: [] };
  const sent = []; let sendStatus = 200; let dropResponse = false;
  const fetch = vi.fn(async (url, options) => {
    expect(options.credentials).toBe('omit'); expect(options.redirect).toBe('error'); expect(options.referrerPolicy).toBe('no-referrer');
    if (url === `${config.apiOrigin}/api/v1/digest`) {
      expect(options.method).toBe('GET'); expect(options.headers.Authorization).toBe('Bearer synthetic-firebase-token');
      return { ok: true, json: async () => globalThis.structuredClone(digest) };
    }
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(options.headers.Authorization).toBe('Bearer synthetic-google-token'); expect(options.method).toBe('POST');
    const body = JSON.parse(options.body); expect(Object.keys(body)).toEqual(['raw']);
    sent.push(Buffer.from(body.raw, 'base64url').toString('utf8'));
    if (dropResponse) throw new Error('synthetic-private-response');
    return { ok: sendStatus === 200, status: sendStatus };
  });
  vi.stubGlobal('chrome', chrome); vi.stubGlobal('fetch', fetch);
  const module = await import('../src/digest-browser.js');
  const sender = { id: 'extension', url: chrome.runtime.getURL('options.html'), frameId: 0 };
  async function message(message, from = sender) {
    return new Promise(resolve => module.handleDigestMessage(message, from, resolve));
  }
  return { ...module, chrome, data, digest, sent, fetch, alarms, message, startup: () => startup(), installed: () => installed(), alarm: name => onAlarm({ name }),
    failSend: (status = 503) => { sendStatus = status; }, loseResponse: () => { dropResponse = true; } };
}
const plan = { planId: '11111111-1111-4111-8111-111111111111', date: '2026-11-07', startsAt: '2026-11-07T13:00:00+09:00', status: 'active',
  subject: '13:00の準備', text: '今日 3限（13:00〜）：架空の課題の準備。', html: '<p>今日 3限（13:00〜）：架空の課題の準備。</p>' };

it('sends once at 7:30 JST, serializes simultaneous alarms, and stores only date and IDs', async () => {
  const f = await fixture(); f.startDigest(); await f.runDigest();
  expect(f.sent).toHaveLength(0);
  expect(f.alarms.get('digest-morning').when).toBe(Date.parse('2026-11-07T07:30:00+09:00'));
  vi.setSystemTime(new Date('2026-11-07T07:30:00+09:00')); f.alarm('digest-morning');
  await Promise.all([f.runDigest(), f.runDigest()]);
  expect(f.sent).toHaveLength(1);
  expect(f.data[receipts]).toEqual({ date: '2026-11-07', planIds: ['morning'] });
  expect(f.sent[0]).toContain(`From: ${mail.to}\r\nTo: ${mail.to}`);
  expect(f.sent[0]).not.toMatch(/\r\n(?:Cc|Bcc|Reply-To):/i);
  expect(f.chrome.identity.getAuthToken).toHaveBeenCalledExactlyOnceWith({ interactive: false, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'] });
});
it('catches up only the current morning on startup and remains duplicate-free after worker restart', async () => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  f.data[receipts] = { date: '2026-11-06', planIds: ['morning', plan.planId] };
  f.startDigest(); f.startup(); await f.runDigest();
  expect(f.sent).toHaveLength(1);
  vi.resetModules(); const restarted = await import('../src/digest-browser.js');
  restarted.startDigest(); await restarted.runDigest(); expect(f.sent).toHaveLength(1);
  vi.setSystemTime(new Date('2026-11-08T07:30:00+09:00')); f.digest.date = '2026-11-08';
  await restarted.runDigest(); expect(f.sent).toHaveLength(2);
});
it('sends just the one preparation mail at 30 minutes, skips elapsed plans, and does not resend a moved ID', async () => {
  const f = await fixture({ now: '2026-11-07T12:29:00+09:00' });
  f.data[receipts] = { date: '2026-11-07', planIds: ['morning'] }; f.digest.plans = [{ ...plan }];
  await f.runDigest(); expect(f.sent).toHaveLength(0);
  vi.setSystemTime(new Date('2026-11-07T12:30:00+09:00')); await f.runDigest(); await f.runDigest();
  expect(f.sent).toHaveLength(1); expect(f.sent[0]).toContain(Buffer.from(plan.text).toString('base64'));
  expect(f.sent[0]).not.toContain(Buffer.from(mail.text).toString('base64'));
  f.digest.plans[0].startsAt = '2026-11-07T14:00:00+09:00';
  vi.setSystemTime(new Date('2026-11-07T13:30:00+09:00')); await f.runDigest(); expect(f.sent).toHaveLength(1);
  f.digest.plans = [{ ...plan, planId: '22222222-2222-4222-8222-222222222222' }];
  await f.runDigest(); expect(f.sent).toHaveLength(1);
});
it('defaults to OFF, requests Gmail permission only on explicit opt-in, and stops when switched off', async () => {
  const f = await fixture({ enabled: false, now: '2026-11-07T10:00:00+09:00' });
  f.startDigest(); await f.runDigest(); expect(await f.message({ type: 'digest-status' })).toEqual({ ok: true, enabled: false });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.chrome.identity.getAuthToken).not.toHaveBeenCalled();
  expect(await f.message({ type: 'digest-setting', enabled: true })).toEqual({ ok: true, enabled: true });
  await f.runDigest(); expect(f.sent).toHaveLength(1);
  expect(f.chrome.identity.getAuthToken.mock.calls[0][0]).toEqual({ interactive: true, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'] });
  expect(await f.message({ type: 'digest-setting', enabled: false })).toEqual({ ok: true, enabled: false });
  f.digest.plans = [{ ...plan }]; vi.setSystemTime(new Date('2026-11-07T12:30:00+09:00'));
  await f.runDigest(); expect(f.sent).toHaveLength(1); expect(f.alarms.size).toBe(0);
});
it.each(['empty', 'other-to', 'google-user', 'firebase-user', 'secret', 'known-sid', 'known-firebase-token', 'known-google-token', 'stale-date', 'revoked', 'scope-denied'])('does not send for %s', async reason => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  if (reason === 'empty') f.digest.empty = true;
  if (reason === 'other-to') f.digest.to = 'other@example.invalid';
  if (reason === 'google-user') state.googleUid = 'other';
  if (reason === 'firebase-user') state.user.uid = 'other';
  if (reason === 'secret') f.digest.html += 'SID&#61;synthetic';
  if (reason === 'known-sid') f.digest.text += 'synthetic-lms-session';
  if (reason === 'known-firebase-token') f.digest.text += 'synthetic-firebase-token';
  if (reason === 'known-google-token') f.digest.text += 'synthetic-google-token';
  if (reason === 'stale-date') f.digest.date = '2026-11-06';
  if (reason === 'revoked') f.chrome.identity.getAuthToken.mockRejectedValue(new Error('synthetic-private-error'));
  if (reason === 'scope-denied') f.chrome.identity.getAuthToken.mockResolvedValue({ token: 'synthetic-google-token', grantedScopes: ['openid', 'email'] });
  await f.runDigest(); expect(f.sent).toHaveLength(0); expect(f.data[receipts]).toBeUndefined();
  expect(JSON.stringify(f.data)).not.toMatch(/synthetic-private-error|SID|今日の準備|@example/);
});
it('rejects LMS pages, other extensions and frames attempting to enable mail', async () => {
  const f = await fixture({ enabled: false });
  for (const sender of [{ id: 'extension', url: 'https://lms.ynu.ac.jp/', frameId: 0 },
    { id: 'other', url: 'chrome-extension://extension/options.html', frameId: 0 },
    { id: 'extension', url: 'chrome-extension://extension/options.html', frameId: 1 }]) {
    expect(await f.message({ type: 'digest-setting', enabled: true }, sender)).toEqual({ ok: false, enabled: false });
  }
  expect(f.chrome.identity.getAuthToken).not.toHaveBeenCalled(); expect(f.data.digestPreference).toBeUndefined();
});
it('keeps OFF when the user disables mail while an earlier permission request is still open', async () => {
  const f = await fixture({ enabled: false, now: '2026-11-07T10:00:00+09:00' });
  let release;
  f.chrome.identity.getAuthToken.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const enabling = f.message({ type: 'digest-setting', enabled: true });
  await vi.waitFor(() => expect(release).toBeDefined());
  await f.message({ type: 'digest-setting', enabled: false });
  release({ token: 'synthetic-google-token' }); await enabling; await f.runDigest();
  expect((await f.message({ type: 'digest-status' })).enabled).toBe(false);
  expect(f.sent).toHaveLength(0);
});
it('clears a preparation error after a later confirmed send', async () => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  f.digest.date = '2026-11-06'; await f.runDigest(); expect(f.data.digestPreference.problem).toBe('invalid-digest');
  f.digest.date = '2026-11-07'; vi.setSystemTime(new Date('2026-11-07T10:15:00+09:00')); await f.runDigest(); expect(f.sent).toHaveLength(1);
  expect((await f.message({ type: 'digest-status' })).problem).toBeUndefined();
});
it.each(['response-lost', 'http-error', 'unauthorized'])('does not duplicate a mail after %s and exposes only a fixed problem', async reason => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  if (reason === 'response-lost') f.loseResponse(); else f.failSend(reason === 'unauthorized' ? 401 : 503);
  await f.runDigest(); await f.runDigest(); expect(f.sent).toHaveLength(1);
  expect((await f.message({ type: 'digest-status' })).problem).toBe('send-unconfirmed');
  expect(JSON.stringify(f.data)).not.toMatch(/synthetic-private-response|synthetic-google-token|今日の準備/);
  if (reason === 'unauthorized') expect(f.chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith({ token: 'synthetic-google-token' });
});

// Review regressions: derive expectations from notification and load requirements.
it('registers listeners without fetching, and catches up on install', async () => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  f.startDigest(); await Promise.resolve(); await Promise.resolve();
  expect(f.fetch).not.toHaveBeenCalled();
  f.installed(); await f.runDigest(); expect(f.sent).toHaveLength(1);
});
it.each([false, true])('bounds daily requests across 1440 alarm-driven worker restarts (API fails: %s)', async fails => {
  const f = await fixture({ now: '2026-11-07T00:00:00+09:00' });
  f.digest.plans = [{ ...plan, startsAt: '2026-11-07T13:07:00+09:00' }];
  if (fails) f.fetch.mockRejectedValue(new Error('synthetic-unavailable'));
  for (let minute = 0; minute < 1440; minute++) {
    vi.setSystemTime(new Date(Date.parse('2026-11-07T00:00:00+09:00') + minute * 60_000));
    vi.resetModules(); const worker = await import('../src/digest-browser.js');
    worker.startDigest(); f.alarm('digest-poll'); await worker.runDigest();
  }
  const requests = f.fetch.mock.calls.filter(([url]) => url.endsWith('/api/v1/digest'));
  expect(requests.length).toBeLessThanOrEqual(98); // 96 refreshes + morning + one plan.
  expect(requests.length).toBe(fails ? 96 : 97);
  if (!fails) expect(f.sent).toHaveLength(2);
  expect(JSON.stringify(f.data)).not.toMatch(/今日の準備|13:00の準備|student@example|synthetic-firebase-token/);
});
it('isolates unsafe morning and plan mails and still sends the later safe plan', async () => {
  const f = await fixture({ now: '2026-11-07T12:30:00+09:00' });
  f.digest.html += 'SID&#61;synthetic';
  f.digest.plans = [{ ...plan, html: 'Cookie: synthetic' }, { ...plan, planId: 'safe-plan' }];
  await f.runDigest();
  expect(f.sent).toHaveLength(1);
  expect(f.data[receipts].planIds).toEqual(['safe-plan']);
  expect(f.data.digestPreference.problem).toBe('unsafe-digest');
});
it('finishes all asynchronous consent and identity reads before reserving a mail', async () => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  const events = [];
  const read = f.chrome.storage.local.get.getMockImplementation();
  const save = f.chrome.storage.local.set.getMockImplementation();
  const fetch = f.fetch.getMockImplementation();
  f.chrome.storage.local.get.mockImplementation(async key => { events.push('read'); return read(key); });
  f.chrome.storage.local.set.mockImplementation(async value => {
    if (value[receipts]?.planIds.includes('morning')) events.push('reserve');
    return save(value);
  });
  f.fetch.mockImplementation(async (url, options) => {
    if (url.includes('/messages/send')) events.push('send');
    return fetch(url, options);
  });
  await f.runDigest(); expect(f.sent).toHaveLength(1);
  expect(events.slice(events.indexOf('reserve'), events.indexOf('send') + 1)).toEqual(['reserve', 'send']);
});
it('does not keep a reservation if switched off while the reservation is being saved', async () => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  const save = f.chrome.storage.local.set.getMockImplementation();
  f.chrome.storage.local.set.mockImplementation(async value => {
    await save(value);
    if (value[receipts]?.planIds.includes('morning')) await f.message({ type: 'digest-setting', enabled: false });
  });
  await f.runDigest(); expect(f.sent).toHaveLength(0);
  expect(f.data[receipts]?.planIds ?? []).toEqual([]);
  expect(f.data.digestPreference.enabled).toBe(false);
});
it('unreserves a plan that expires while saving and continues with the next plan', async () => {
  const f = await fixture({ now: '2026-11-07T12:59:00+09:00' });
  f.data[receipts] = { date: '2026-11-07', planIds: ['morning'] };
  f.digest.plans = [{ ...plan }, { ...plan, planId: 'later-plan', startsAt: '2026-11-07T13:10:00+09:00' }];
  const save = f.chrome.storage.local.set.getMockImplementation();
  f.chrome.storage.local.set.mockImplementation(async value => {
    await save(value);
    if (value[receipts]?.planIds.includes(plan.planId)) vi.setSystemTime(new Date('2026-11-07T13:00:00+09:00'));
  });
  await f.runDigest();
  expect(f.sent).toHaveLength(1);
  expect(f.data[receipts].planIds).toEqual(['morning', 'later-plan']);
});
it.each(['empty', 'no-due'])('clears a recovered error on a healthy %s result', async kind => {
  const f = await fixture({ now: '2026-11-07T10:00:00+09:00' });
  f.data.digestPreference.problem = 'unsafe-digest'; f.data.digestPreference.problemDate = '2026-11-07';
  if (kind === 'empty') f.digest.empty = true;
  else f.data[receipts] = { date: '2026-11-07', planIds: ['morning'] };
  await f.runDigest(); expect(f.data.digestPreference.problem).toBeUndefined();
});
it('clears yesterday’s uncertain delivery even before the next morning', async () => {
  const f = await fixture({ now: '2026-11-08T00:01:00+09:00' });
  f.data.digestPreference.problem = 'send-unconfirmed'; f.data.digestPreference.problemDate = '2026-11-07';
  f.digest.date = '2026-11-08'; f.digest.empty = true;
  await f.runDigest(); expect(f.data.digestPreference.problem).toBeUndefined();
});

it('uses only cached IDs and times between refreshes, then revalidates a cancelled plan at its window', async () => {
  const f = await fixture({ now: '2026-11-07T12:29:00+09:00' });
  f.data[receipts] = { date: '2026-11-07', planIds: ['morning'] };
  f.digest.plans = [{ ...plan }]; await f.runDigest();
  const cache = f.data[`digestSchedule:${namespace}:owner`];
  expect(cache.plans).toEqual([{ planId: plan.planId, startsAt: plan.startsAt }]);
  f.digest.plans = [];
  vi.setSystemTime(new Date('2026-11-07T12:30:00+09:00')); await f.runDigest();
  expect(f.sent).toHaveLength(0); expect(f.fetch).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date('2026-11-07T12:44:00+09:00')); await f.runDigest();
  expect(f.fetch).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date('2026-11-07T12:45:00+09:00')); await f.runDigest();
  expect(f.fetch).toHaveBeenCalledTimes(3);
});
