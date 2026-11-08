import type { Firestore } from 'firebase-admin/firestore';
import type { NotificationSettings, NotificationStatus } from '@kadai-hisho/core';
import { singleMailbox, type SenderState } from './mail-sender.js';
import { SessionForbidden } from '../sessions/store.js';

export class NotificationSettingsConflict extends Error {}
export class NotificationNotReady extends Error {}
export interface NotificationSettingsView {
  settings: NotificationSettings;
  status: NotificationStatus | null;
  availability: SenderState | 'migration-pending' | 'recipient-unavailable';
}
export function createNotificationSettingsStore(db: Firestore, options: {
  checkSender: () => Promise<SenderState>;
  resolveRecipient: (uid: string) => Promise<string | null>;
  clock?: () => Date;
}) {
  return async (uid: string, input?: { enabled: boolean; version: number }): Promise<NotificationSettingsView> => {
    const sender = await options.checkSender();
    const recipient = await options.resolveRecipient(uid);
    return db.runTransaction(async tx => {
      // Shared student access never grants notification access. Demo mail remains simulated.
      if ((await tx.get(db.doc(`demoAccounts/${uid}`))).exists) throw new SessionForbidden();
      const base = db.doc(`students/${uid}`);
      const ref = base.collection('notificationSettings').doc('current');
      const saved = (await tx.get(ref)).data() as NotificationSettings | undefined;
      const status = (await tx.get(base.collection('notificationStatus').doc('current'))).data() as NotificationStatus | undefined;
      const current: NotificationSettings = saved ?? { enabled: false, deliveryOwner: 'none', version: 1,
        timeZone: 'Asia/Tokyo', morningTime: '07:30', recipientUid: uid, migrationState: 'not-started',
        updatedAt: new Date(0).toISOString() };
      if (current.recipientUid !== uid) throw new SessionForbidden();
      const migrated = current.deliveryOwner === 'cloud' && current.migrationState === 'ready';
      const availability = sender !== 'ready' ? sender : !recipient || !singleMailbox(recipient) ? 'recipient-unavailable' :
        !migrated ? 'migration-pending' : 'ready';
      let settings = current;
      if (input) {
        if (input.enabled && availability !== 'ready') throw new NotificationNotReady();
        if (current.version !== input.version && current.enabled !== input.enabled) throw new NotificationSettingsConflict();
        if (current.enabled !== input.enabled || !saved) {
          settings = { ...current, enabled: input.enabled, version: current.version + 1,
            updatedAt: (options.clock?.() ?? new Date()).toISOString() };
          tx.set(ref, settings);
        }
      }
      return { settings, status: status ?? null, availability };
    });
  };
}
export type NotificationSettingsStore = ReturnType<typeof createNotificationSettingsStore>;
