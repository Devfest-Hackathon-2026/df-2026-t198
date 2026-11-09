import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { createHttpServer } from '../src/http.js';
import { firebaseDependencies } from '../src/firebase.js';
import { createNotificationSettingsStore } from '../src/notifications/settings.js';
import { createMailSender, type SenderState } from '../src/notifications/mail-sender.js';
import { createNotificationDispatch } from '../src/notifications/dispatch.js';
import { createNotificationStore } from '../src/notifications/store.js';
import { notificationFixture, origin } from './notification-fixture.js';

describe.skipIf(process.env['RUN_NOTIFICATION_EMULATOR_TESTS'] !== '1')('A1 notification settings with Auth/Firestore', () => {
  let f: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  let server: ReturnType<typeof createHttpServer>, base: string;
  let senderState: SenderState = 'ready';
  const cutover = new Date('2030-11-11T12:45:00+09:00');
  let now = cutover;
  const owner = 'settings-owner', other = 'settings-other', supporter = 'settings-supporter', noEmail = 'settings-no-email';
  const tokens = new Map<string, string>();
  const ref = (uid = owner) => f.db.doc(`students/${uid}/notificationSettings/current`);
  const call = (uid = owner, body?: unknown, suffix = '') => fetch(base + '/api/v1/notification-settings' + suffix, {
    method: body === undefined ? 'GET' : 'PUT', headers: { Authorization: `Bearer ${tokens.get(uid)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeAll(async () => {
    f = await sessionEmulatorFixture();
    const dependencies = firebaseDependencies();
    dependencies.notificationSettings = createNotificationSettingsStore(f.db, {
      checkSender: async () => senderState,
      clock: () => now,
      resolveRecipient: async uid => { const u = await f.auth.getUser(uid); return !u.disabled && u.emailVerified ? u.email ?? null : null; },
    });
    server = createHttpServer(dependencies);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    base = `http://127.0.0.1:${address.port}`;
    for (const uid of [owner, other, supporter, noEmail]) {
      await f.auth.createUser({ uid, ...(uid === noEmail ? {} : { email: `${uid}@example.invalid`, emailVerified: true }) });
      const result = await fetch(`http://${process.env['FIREBASE_AUTH_EMULATOR_HOST']}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: await f.auth.createCustomToken(uid), returnSecureToken: true }),
      });
      tokens.set(uid, (await result.json() as { idToken: string }).idToken);
    }
    await f.db.doc(`demoAccounts/${supporter}`).set({ role: 'supporter', studentId: owner });
    await f.db.doc(`students/${owner}/supporters/${supporter}`).set({ scopes: ['all'], revokedAt: null });
  });
  beforeEach(async () => {
    senderState = 'ready'; now = cutover;
    await ref().set({ ...notificationFixture().settings!, recipientUid: owner, enabled: false });
    await f.db.doc(`students/${owner}/notificationStatus/current`).delete();
    await f.auth.updateUser(owner, { disabled: false, emailVerified: true });
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (f) for (const uid of [owner, other, supporter, noEmail]) {
      await f.db.recursiveDelete(f.db.doc(`students/${uid}`));
      await f.db.doc(`demoAccounts/${uid}`).delete();
      await f.auth.deleteUser(uid);
    }
    await f?.close();
  });

  it('persists enable/stop and handles simultaneous duplicate saves without fabricating acceptance', async () => {
    const responses = await Promise.all([call(owner, { enabled: true, version: 1 }), call(owner, { enabled: true, version: 1 })]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect((await ref().get()).data()).toMatchObject({ enabled: true, version: 2, deliveryOwner: 'cloud', migrationState: 'ready' });
    expect(await (await call()).json()).toMatchObject({ settings: { enabled: true, version: 2 }, status: null });
    expect((await call(owner, { enabled: false, version: 1 })).status).toBe(409);
    expect((await call(owner, { enabled: false, version: 2 })).status).toBe(200);
    expect((await ref().get()).data()).toMatchObject({ enabled: false, version: 3 });
  });
  it('never trusts another UID or recipient, including a supporter with sharing permission', async () => {
    for (const uid of [owner, other, supporter, noEmail]) {
      expect((await call(uid, { enabled: true, version: 1, uid: owner, to: 'arbitrary' })).status).toBe(400);
      expect((await call(uid, undefined, `?uid=${owner}`)).status).toBe(400);
    }
    expect((await call(supporter)).status).toBe(403);
    expect((await call(supporter, { enabled: true, version: 1 })).status).toBe(403);
    expect(await (await call(other)).json()).toMatchObject({ settings: { recipientUid: other, enabled: false } });
    expect((await ref().get()).data()!['enabled']).toBe(false);
  });
  it.each(['preparing', 'authorization-required'] as const)('cannot enable when sender is %s, but can stop', async state => {
    senderState = state;
    expect(await (await call()).json()).toMatchObject({ availability: state });
    expect((await call(owner, { enabled: true, version: 1 })).status).toBe(409);
    await ref().update({ enabled: true });
    expect((await call(owner, { enabled: false, version: 1 })).status).toBe(200);
  });
  it.each(['missing', 'none', 'extension'] as const)('enables and atomically migrates %s settings once', async previousOwner => {
    if (previousOwner === 'missing') await ref().delete();
    else await ref().update({ deliveryOwner: previousOwner, migrationState: 'not-started' });
    expect(await (await call()).json()).toMatchObject({ availability: 'ready' });
    const responses = await Promise.all([call(undefined, { enabled: true, version: 1 }), call(undefined, { enabled: true, version: 1 })]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const migrated = (await ref().get()).data();
    expect(migrated).toMatchObject({ enabled: true, deliveryOwner: 'cloud', migrationState: 'ready',
      cloudSince: cutover.toISOString(), updatedAt: cutover.toISOString(), version: 2 });
    now = new Date('2030-11-12T07:45:00+09:00');
    expect((await call(undefined, { enabled: true, version: 1 })).status).toBe(200);
    expect((await ref().get()).data()).toEqual(migrated);
    expect((await call(undefined, { enabled: false, version: 2 })).status).toBe(200);
    expect((await ref().get()).data()).toMatchObject({ enabled: false, deliveryOwner: 'cloud', cloudSince: cutover.toISOString() });
    expect((await call(undefined, { enabled: true, version: 3 })).status).toBe(200);
    expect((await ref().get()).data()).toMatchObject({ enabled: true, deliveryOwner: 'cloud', cloudSince: cutover.toISOString(), version: 4 });
  });
  it('rejects a stale cutover without changing the owner or timestamp', async () => {
    await ref().update({ deliveryOwner: 'extension', migrationState: 'not-started', enabled: true, version: 2 });
    expect((await call(undefined, { enabled: true, version: 1 })).status).toBe(409);
    expect((await ref().get()).data()).toMatchObject({ deliveryOwner: 'extension', version: 2 });
    expect((await ref().get()).data()).not.toHaveProperty('cloudSince');
    expect((await call(undefined, { enabled: true, version: 2 })).status).toBe(200);
    expect((await ref().get()).data()).toMatchObject({ deliveryOwner: 'cloud', version: 3, cloudSince: cutover.toISOString() });
  });
  it('keeps a manual migration without cloudSince compatible on stop and resume', async () => {
    expect((await call(undefined, { enabled: true, version: 1 })).status).toBe(200);
    expect((await ref().get()).data()).not.toHaveProperty('cloudSince');
    expect((await call(undefined, { enabled: false, version: 2 })).status).toBe(200);
    expect((await ref().get()).data()).toMatchObject({ enabled: false, deliveryOwner: 'cloud', migrationState: 'ready' });
  });
  it('refuses missing and unverified recipients and rejects demo students', async () => {
    expect(await (await call(noEmail)).json()).toMatchObject({ availability: 'recipient-unavailable' });
    expect((await call(noEmail, { enabled: true, version: 1 })).status).toBe(409);
    expect((await ref(noEmail).get()).exists).toBe(false);
    await f.auth.updateUser(owner, { emailVerified: false });
    expect(await (await call()).json()).toMatchObject({ availability: 'recipient-unavailable' });
    expect((await call(owner, { enabled: true, version: 1 })).status).toBe(409);
    await f.db.doc(`demoAccounts/${other}`).set({ role: 'student', studentId: other });
    try {
      expect((await call(other)).status).toBe(403);
      expect((await call(other, { enabled: true, version: 1 })).status).toBe(403);
    }
    finally { await f.db.doc(`demoAccounts/${other}`).delete(); }
  });
  it('returns only fixed errors for malformed requests and internal failures', async () => {
    expect((await call(owner, null)).status).toBe(400);
    expect((await call(owner, { enabled: true, version: 1, deliveryOwner: 'cloud' })).status).toBe(400);
    expect((await call(owner, { enabled: true, version: 1, cloudSince: '2000-01-01T00:00:00Z' })).status).toBe(400);
    expect((await call(owner, { enabled: true, version: 1, secret: 'x'.repeat(1100) })).status).toBe(413);
  });
  it('rejects an already-issued token when its account has been disabled', async () => {
    await f.auth.updateUser(owner, { disabled: true });
    expect((await call()).status).toBe(401);
    expect((await call(owner, { enabled: true, version: 1 })).status).toBe(401);
  });
  it('stores fake Gmail acceptance once, and exposes historical acceptance alongside later failure/unknown', async () => {
    const data = notificationFixture();
    await ref().update({ enabled: true });
    await f.db.doc(`students/${owner}/assignments/task`).set(data.assignments[0]!);
    await f.db.doc(`students/${owner}/courses/course`).set(data.courses[0]!);
    await f.db.doc(`students/${owner}/plans/plan`).set(data.plans[0]!);
    const fetcher = vi.fn<typeof fetch>(async url => String(url).includes('oauth2') ?
      Response.json({ access_token: 'dummy-access', token_type: 'Bearer', expires_in: 3600 }) : Response.json({ id: 'fake-accepted' }));
    const sender = createMailSender({ from: 'sender@example.invalid', clientId: 'dummy', clientSecret: 'dummy', refreshToken: 'dummy', fetch: fetcher });
    const now = new Date('2030-11-11T07:30:00+09:00');
    const store = createNotificationStore(f.db, origin, () => now);
    // Limit enumeration to this test's student; retain the real transactional send path.
    const tick = createNotificationDispatch({ ...store, users: async () => [owner] }, {
      origin, sender, enabled: true, clock: () => now, resolveRecipient: async () => `${owner}@example.invalid`,
    });
    const runs = await Promise.all([tick(), tick()]);
    expect(runs.reduce((n, run) => n + run.attempted, 0)).toBe(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/messages/send'))).toHaveLength(1);
    expect(await (await call()).json()).toMatchObject({ status: { state: 'accepted', lastAcceptedAt: now.toISOString() } });
    for (const [state, errorCode] of [['failed', 'authorization-required'], ['unknown', 'outcome-unknown']] as const) {
      await f.db.doc(`students/${owner}/notificationStatus/current`).update({ state, errorCode });
      expect(await (await call()).json()).toMatchObject({ status: { state, errorCode, lastAcceptedAt: now.toISOString() } });
    }
    await call(owner, { enabled: false, version: 1 });
    expect((await tick()).attempted).toBe(0);
  });
});
