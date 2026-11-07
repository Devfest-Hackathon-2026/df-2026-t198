import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { Course, FetchState, LedgerAssignment, LmsSystem, NotificationDelivery, NotificationErrorCode,
  NotificationSettings, NotificationStatus, NotificationTarget, PreparationPlan } from '@kadai-hisho/core';
import { cloudNotificationsEnabled, notificationMessage, notificationTargets, type NotificationSnapshot } from './notification-targets.js';

const LEASE_MS = 120_000;
export function createNotificationStore(db: Firestore, origin: string, clock: () => Date = () => new Date()) {
  const student = (uid: string) => db.collection('students').doc(uid);
  const deliveryRef = (uid: string, key: string) => student(uid).collection('notificationDeliveries').doc(key);
  async function snapshot(tx: Transaction, uid: string): Promise<NotificationSnapshot> {
    const base = student(uid);
    const settings = (await tx.get(base.collection('notificationSettings').doc('current'))).data() as NotificationSettings | undefined;
    const demo = (await tx.get(db.collection('demoAccounts').doc(uid))).exists;
    async function rows<T>(name: string, limit: number): Promise<T[]> {
      const docs = await tx.get(base.collection(name).limit(limit + 1));
      if (docs.size > limit) throw new Error('notification-read-limit');
      return docs.docs.map(doc => doc.data() as T);
    }
    return { uid, settings, demo, plans: await rows<PreparationPlan>('plans', 200),
      assignments: await rows<LedgerAssignment>('assignments', 200),
      courses: await rows<Course & { system: LmsSystem }>('courses', 100), fetchStates: await rows<FetchState>('fetchStates', 3) };
  }
  async function writeState(tx: Transaction, uid: string, delivery: NotificationDelivery, now: Date) {
    const ref = student(uid).collection('notificationStatus').doc('current');
    const previous = (await tx.get(ref)).data() as NotificationStatus | undefined;
    tx.set(deliveryRef(uid, delivery.key), delivery);
    tx.set(ref, { state: delivery.state, settingsVersion: delivery.settingsVersion, updatedAt: now.toISOString(),
      lastAcceptedAt: delivery.state === 'accepted' ? now.toISOString() : previous?.lastAcceptedAt ?? null,
      errorCode: delivery.errorCode } satisfies NotificationStatus);
  }
  return {
    async users() {
      // No parent document assumption or new index. Overflow fails visibly, never silently starves a user.
      const docs = await db.collectionGroup('notificationSettings').limit(51).get();
      if (docs.size > 50) throw new Error('notification-user-limit');
      return docs.docs.flatMap(doc => {
        const parts = doc.ref.path.split('/');
        return parts.length === 4 && parts[0] === 'students' && parts[3] === 'current' ? [parts[1]!] : [];
      });
    },
    read: (uid: string) => db.runTransaction(tx => snapshot(tx, uid)),
    async enqueue(uid: string, target: NotificationTarget, settingsVersion: number) {
      await db.runTransaction(async tx => {
        const ref = deliveryRef(uid, target.key);
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, { ...target, settingsVersion, state: 'pending', attemptId: null, reservedAt: null,
          leaseUntil: null, startedAt: null, respondedAt: null, errorCode: null } satisfies NotificationDelivery);
      });
    },
    async reserve(uid: string, key: string): Promise<string | null> {
      const attempt = randomUUID();
      return db.runTransaction(async tx => {
        const now = clock();
        const d = (await tx.get(deliveryRef(uid, key))).data() as NotificationDelivery | undefined;
        if (!d) return null;
        if (d.state === 'sending' && Date.parse(d.leaseUntil!) <= now.getTime()) {
          await writeState(tx, uid, { ...d, state: 'unknown', errorCode: 'outcome-unknown', respondedAt: now.toISOString() }, now);
          return null;
        }
        if (d.state !== 'pending' && !(d.state === 'reserved' && Date.parse(d.leaseUntil!) <= now.getTime())) return null;
        if (Date.parse(d.expiresAt) <= now.getTime()) {
          await writeState(tx, uid, { ...d, state: 'expired', errorCode: 'window-closed' }, now); return null;
        }
        await writeState(tx, uid, { ...d, state: 'reserved', attemptId: attempt,
          reservedAt: now.toISOString(), leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString() }, now);
        return attempt;
      });
    },
    async start(uid: string, key: string, attempt: string) {
      return db.runTransaction(async tx => {
        const now = clock();
        const d = (await tx.get(deliveryRef(uid, key))).data() as NotificationDelivery | undefined;
        if (!d || d.state !== 'reserved' || d.attemptId !== attempt || Date.parse(d.leaseUntil!) <= now.getTime()) return null;
        const data = await snapshot(tx, uid);
        let error: NotificationErrorCode | null = null;
        if (!cloudNotificationsEnabled(data) || data.settings?.version !== d.settingsVersion) error = 'settings-changed';
        const target = notificationTargets(data, now, origin).find(t => t.key === key && t.planRevision === d.planRevision);
        if (!target && !error) error = Date.parse(d.expiresAt) <= now.getTime() ? 'window-closed' : 'target-changed';
        if (error) {
          await writeState(tx, uid, { ...d, state: error === 'window-closed' ? 'expired' : 'skipped', errorCode: error }, now);
          return null;
        }
        const message = notificationMessage(data, target!, now, origin);
        await writeState(tx, uid, { ...d, state: 'sending', startedAt: now.toISOString(),
          leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString() }, now);
        return message;
      });
    },
    async finish(uid: string, key: string, attempt: string, state: 'accepted' | 'failed' | 'unknown', errorCode: NotificationErrorCode | null) {
      await db.runTransaction(async tx => {
        const d = (await tx.get(deliveryRef(uid, key))).data() as NotificationDelivery | undefined;
        if (!d || d.state !== 'sending' || d.attemptId !== attempt) return;
        const now = clock();
        await writeState(tx, uid, { ...d, state, errorCode, respondedAt: now.toISOString() }, now);
      });
    },
    async recover(uid: string) {
      // Read only the bounded set of in-flight attempts, not the unbounded delivery history.
      const docs = await student(uid).collection('notificationDeliveries').where('state', 'in', ['pending', 'reserved', 'sending']).limit(201).get();
      if (docs.size > 200) throw new Error('notification-recovery-limit');
      for (const doc of docs.docs) {
        const d = doc.data() as NotificationDelivery;
        if (d.state === 'sending') await this.reserve(uid, doc.id);
        else await db.runTransaction(async tx => {
          const current = (await tx.get(doc.ref)).data() as NotificationDelivery | undefined;
          const now = clock();
          if (!current || (current.state !== 'pending' &&
            !(current.state === 'reserved' && Date.parse(current.leaseUntil!) <= now.getTime()))) return;
          const data = await snapshot(tx, uid);
          const expired = Date.parse(current.expiresAt) <= now.getTime();
          const unchanged = cloudNotificationsEnabled(data) && data.settings?.version === current.settingsVersion &&
            notificationTargets(data, now, origin).some(t => t.key === current.key && t.planRevision === current.planRevision);
          if (current.state === 'pending' && unchanged && !expired) return;
          await writeState(tx, uid, { ...current, state: expired ? 'expired' : unchanged ? 'pending' : 'skipped',
            errorCode: expired ? 'window-closed' : unchanged ? null : 'target-changed', attemptId: null, leaseUntil: null }, now);
        });
      }
    },
  };
}
export type NotificationStore = ReturnType<typeof createNotificationStore>;
