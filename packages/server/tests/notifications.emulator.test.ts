import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDelivery, NotificationTarget } from '@kadai-hisho/core';
import { createNotificationStore } from '../src/notification-store.js';
import { createNotificationDispatch, type NotificationSender } from '../src/notification-dispatch.js';
import { notificationTargets } from '../src/notification-targets.js';
import { sessionEmulatorFixture } from './session-emulator-fixture.js';
import { notificationFixture, origin, recipient } from './notification-fixture.js';

describe.skipIf(process.env['RUN_NOTIFICATION_EMULATOR_TESTS'] !== '1')('durable fake-sender dispatch (#156 N1-N4)', () => {
  let fixture: Awaited<ReturnType<typeof sessionEmulatorFixture>>;
  let store: ReturnType<typeof createNotificationStore>;
  let now: Date;
  const uid = notificationFixture().uid;
  const student = () => fixture.db.collection('students').doc(uid);
  const settings = () => student().collection('notificationSettings').doc('current');
  const delivery = (key: string) => student().collection('notificationDeliveries').doc(key);
  const saved = async (key: string) => (await delivery(key).get()).data() as NotificationDelivery;
  const send = vi.fn<NotificationSender['send']>();
  const recipientFor = vi.fn(async (requested: string) => requested === uid ? recipient : null);
  const dispatch = (enabled = true, sender: NotificationSender | undefined = { send }) => createNotificationDispatch(store, {
    origin, enabled, ...(sender ? { sender } : {}), resolveRecipient: recipientFor, clock: () => now,
  });
  async function queued(): Promise<NotificationTarget> {
    const data = await store.read(uid);
    const target = notificationTargets(data, now, origin)[0]!;
    await store.enqueue(uid, target, data.settings!.version);
    return target;
  }
  beforeAll(async () => { fixture = await sessionEmulatorFixture(); });
  beforeEach(async () => {
    now = new Date('2030-11-11T12:30:00+09:00');
    store = createNotificationStore(fixture.db, origin, () => now);
    await student().delete();
    await fixture.db.doc(`demoAccounts/${uid}`).delete();
    for (const name of ['notificationSettings', 'notificationStatus', 'notificationDeliveries', 'plans', 'assignments', 'courses', 'fetchStates']) {
      const docs = await student().collection(name).get();
      if (!docs.empty) { const batch = fixture.db.batch(); for (const doc of docs.docs) batch.delete(doc.ref); await batch.commit(); }
    }
    const data = notificationFixture();
    await settings().set(data.settings!);
    await student().collection('plans').doc(data.plans[0]!.planId).set(data.plans[0]!);
    await student().collection('assignments').doc('fictional').set(data.assignments[0]!);
    await student().collection('courses').doc('fictional').set(data.courses[0]!);
    await student().collection('fetchStates').doc('ynu-lms').set(data.fetchStates[0]!);
    send.mockReset(); send.mockResolvedValue({ state: 'accepted' }); recipientFor.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await fixture?.close(); });

  it('enumerates settings without requiring student parent documents and ignores nested impostors', async () => {
    expect((await student().get()).exists).toBe(false);
    await fixture.db.doc('unrelated/value/notificationSettings/current').set(notificationFixture().settings!);
    expect(await store.users()).toContain(uid);
    expect(await store.users()).not.toContain('value');
    await fixture.db.doc('unrelated/value/notificationSettings/current').delete();
  });
  it('dry-run neither reserves nor sends, including enabled-without-adapter', async () => {
    expect(await dispatch(false)()).toEqual({ dryRun: true, candidates: 1, attempted: 0 });
    const noSender = createNotificationDispatch(store, { origin, enabled: true, resolveRecipient: recipientFor, clock: () => now });
    expect((await noSender()).dryRun).toBe(true);
    expect(send).not.toHaveBeenCalled(); expect(recipientFor).not.toHaveBeenCalled();
    expect((await student().collection('notificationDeliveries').get()).empty).toBe(true);
    expect((await student().collection('notificationStatus').get()).empty).toBe(true);
  });
  it('concurrent and repeated ticks call the sender once and retain API acceptance, never inbox delivery', async () => {
    const target = notificationTargets(await store.read(uid), now, origin)[0]!;
    await Promise.all([dispatch()(), dispatch()(), dispatch()()]); await dispatch()();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await saved(target.key)).toMatchObject({ state: 'accepted', errorCode: null });
    expect(recipientFor).toHaveBeenCalledWith(uid);
    expect(send.mock.calls[0]![0].to).toBe(recipient);
    const text = JSON.stringify((await delivery(target.key).get()).data());
    expect(text).not.toContain(recipient); expect(text).not.toContain('架空のレポート');
    expect((await student().collection('notificationStatus').doc('current').get()).data()).toMatchObject({ state: 'accepted', lastAcceptedAt: now.toISOString() });
  });
  it('reclaims only reservations and prevents a stale attempt from starting or recording a result', async () => {
    const target = await queued();
    expect((await saved(target.key)).state).toBe('pending');
    const old = (await store.reserve(uid, target.key))!;
    now = new Date(now.getTime() + 120_000);
    const current = (await store.reserve(uid, target.key))!;
    expect(current).not.toBe(old);
    expect(await store.start(uid, target.key, old)).toBeNull();
    await store.finish(uid, target.key, old, 'accepted', null);
    expect((await saved(target.key)).state).toBe('reserved');
    expect(await store.start(uid, target.key, current)).not.toBeNull();
    await store.finish(uid, target.key, old, 'accepted', null);
    expect((await saved(target.key)).state).toBe('sending');
  });
  it.each(['done', 'cancelled', 'submitted', 'ended', 'moved', 'revision', 'disabled', 'version', 'recipient', 'demo'] as const)(
    'rechecks %s before committing sending', async change => {
      const target = await queued(), attempt = (await store.reserve(uid, target.key))!;
      const plan = student().collection('plans').doc(target.planId!);
      if (change === 'done' || change === 'cancelled') await plan.update({ status: change });
      if (change === 'submitted') await student().collection('assignments').doc('fictional').update({ submission: 'submitted' });
      if (change === 'ended') await student().collection('assignments').doc('fictional').update({ presenceState: 'ended' });
      if (change === 'moved') await plan.update({ startsAt: '2030-11-11T14:00:00+09:00', revision: 2 });
      if (change === 'revision') await plan.update({ revision: 2 });
      if (change === 'disabled') await settings().update({ enabled: false, version: 2 });
      if (change === 'version') await settings().update({ version: 2 });
      if (change === 'recipient') await settings().update({ recipientUid: 'other' });
      if (change === 'demo') await fixture.db.doc(`demoAccounts/${uid}`).set({ role: 'student', studentId: uid });
      expect(await store.start(uid, target.key, attempt)).toBeNull();
      expect((await saved(target.key)).state).toBe('skipped'); expect(send).not.toHaveBeenCalled();
    });
  it('renders current titles when sending starts', async () => {
    const target = await queued(), attempt = (await store.reserve(uid, target.key))!;
    await student().collection('assignments').doc('fictional').update({ 'latest.title': '更新した架空課題' });
    expect((await store.start(uid, target.key, attempt))?.text).toContain('更新した架空課題');
  });
  it('expires pending and abandoned reserved deliveries after the notification window closes', async () => {
    const target = await queued();
    now = new Date('2030-11-11T13:00:00+09:00');
    expect(await store.reserve(uid, target.key)).toBeNull();
    expect((await saved(target.key)).state).toBe('expired');
    now = new Date('2030-11-12T12:30:00+09:00');
    const plan = student().collection('plans').doc(target.planId!);
    await plan.update({ date: '2030-11-12', startsAt: '2030-11-12T13:00:00+09:00', endsAt: '2030-11-12T14:00:00+09:00' });
    const tomorrow = await queued(); await store.reserve(uid, tomorrow.key);
    now = new Date('2030-11-12T13:00:00+09:00');
    await store.recover(uid);
    expect((await saved(tomorrow.key)).state).toBe('expired');
  });
  it('allows a send already in progress to finish after OFF, without starting another send', async () => {
    send.mockImplementationOnce(async () => { await settings().update({ enabled: false, version: 2 }); return { state: 'accepted' }; });
    await dispatch()(); await dispatch()();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await student().collection('notificationDeliveries').get()).docs[0]!.data()['state']).toBe('accepted');
  });
  it('does not resend unknown after response loss, restart, a version bump, or moving back to the same instant', async () => {
    send.mockRejectedValueOnce(new Error('synthetic-response-loss'));
    const target = await queued();
    await dispatch()();
    expect((await saved(target.key)).state).toBe('unknown');
    await settings().update({ version: 2 });
    const plan = student().collection('plans').doc(target.planId!);
    await plan.update({ startsAt: '2030-11-11T15:00:00+09:00', revision: 2 }); await dispatch()();
    await plan.update({ startsAt: target.startsAt, revision: 3 });
    store = createNotificationStore(fixture.db, origin, () => now);
    await dispatch()(); expect(send).toHaveBeenCalledTimes(1);
  });
  it('records unknown when provider acceptance is followed by a failed result save', async () => {
    const target = await queued();
    vi.spyOn(store, 'finish').mockRejectedValueOnce(new Error('synthetic-save-failure'));
    await dispatch()(); await dispatch()();
    expect(send).toHaveBeenCalledTimes(1); expect((await saved(target.key)).state).toBe('unknown');
  });
  it('recovers persisted sending after both result saves fail, even after OFF and outside the window', async () => {
    const target = await queued();
    const finish = vi.spyOn(store, 'finish').mockRejectedValue(new Error('synthetic-db-outage'));
    await expect(dispatch()()).rejects.toThrow();
    expect((await saved(target.key)).state).toBe('sending'); finish.mockRestore();
    await settings().update({ enabled: false, version: 2 });
    now = new Date('2030-11-11T14:00:00+09:00');
    await dispatch()();
    expect(send).toHaveBeenCalledTimes(1); expect((await saved(target.key)).state).toBe('unknown');
  });
  it('a process killed after sending starts never makes that attempt eligible for resend', async () => {
    const target = await queued(), attempt = (await store.reserve(uid, target.key))!;
    await store.start(uid, target.key, attempt);
    now = new Date(now.getTime() + 120_001);
    await dispatch()();
    expect((await saved(target.key)).state).toBe('unknown'); expect(send).not.toHaveBeenCalled();
  });
  it('retains a definite non-acceptance as failed, without a hidden POST retry', async () => {
    const target = await queued();
    send.mockResolvedValueOnce({ state: 'failed', errorCode: 'authorization-required' });
    await dispatch()(); await dispatch()();
    expect(await saved(target.key)).toMatchObject({ state: 'failed', errorCode: 'authorization-required' });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('never dispatches demo accounts, missing settings or an unverified/missing recipient', async () => {
    await fixture.db.doc(`demoAccounts/${uid}`).set({ role: 'student', studentId: uid });
    expect((await dispatch()()).candidates).toBe(0);
    await fixture.db.doc(`demoAccounts/${uid}`).delete();
    recipientFor.mockResolvedValueOnce(null); await dispatch()();
    expect(send).not.toHaveBeenCalled();
    await settings().delete(); expect((await dispatch()()).candidates).toBe(0);
  });
  it('fails visibly on oversized reads and user enumeration instead of sending truncated data', async () => {
    const batch = fixture.db.batch();
    for (let n = 0; n < 101; n++) batch.set(student().collection('courses').doc(`overflow-${n}`), notificationFixture().courses[0]!);
    await batch.commit();
    await expect(store.read(uid)).rejects.toThrow('notification-read-limit');
    const refs = Array.from({ length: 51 }, (_, n) => fixture.db.doc(`overflow/${n}/notificationSettings/current`));
    const settingsBatch = fixture.db.batch(); for (const ref of refs) settingsBatch.set(ref, { enabled: false });
    await settingsBatch.commit();
    try { await expect(store.users()).rejects.toThrow('notification-user-limit'); }
    finally { const remove = fixture.db.batch(); for (const ref of refs) remove.delete(ref); await remove.commit(); }
    expect(send).not.toHaveBeenCalled();
  });
});
