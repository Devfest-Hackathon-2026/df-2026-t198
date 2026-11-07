import { isSafeMailText } from '@kadai-hisho/core';
import type { NotificationErrorCode } from '@kadai-hisho/core';
import { notificationTargets, type NotificationMessage } from './notification-targets.js';
import type { NotificationStore } from './notification-store.js';

/** The adapter must not retry POST, and may report failed only when non-acceptance is certain. */
export interface NotificationSender {
  send(message: NotificationMessage & { to: string }): Promise<
    { state: 'accepted' } | { state: 'failed'; errorCode: 'authorization-required' | 'not-accepted' } | { state: 'unknown' }>;
}
export interface NotificationDispatchOptions {
  origin: string;
  sender?: NotificationSender;
  resolveRecipient: (uid: string) => Promise<string | null>;
  enabled?: boolean;
  clock?: () => Date;
}
export function createNotificationDispatch(store: NotificationStore, options: NotificationDispatchOptions) {
  const clock = options.clock ?? (() => new Date());
  return async () => {
    const dryRun = options.enabled !== true || !options.sender;
    let candidates = 0, attempted = 0;
    for (const uid of await store.users()) {
      if (!dryRun) await store.recover(uid);
      const data = await store.read(uid);
      const targets = notificationTargets(data, clock(), options.origin);
      candidates += targets.length;
      if (targets.length > 200) throw new Error('notification-attempt-limit');
      if (dryRun) continue;
      for (const target of targets) {
        await store.enqueue(uid, target, data.settings!.version);
        const attempt = await store.reserve(uid, target.key);
        if (!attempt) continue;
        const to = await options.resolveRecipient(uid);
        if (!to || !isSafeMailText(to) || /[\r\n]/.test(to)) continue;
        const message = await store.start(uid, target.key, attempt);
        if (!message) continue;
        attempted++;
        let state: 'accepted' | 'failed' | 'unknown' = 'unknown';
        let code: NotificationErrorCode | null = 'outcome-unknown';
        try {
          const result = await options.sender!.send({ ...message, to });
          state = result.state;
          code = result.state === 'failed' ? result.errorCode : result.state === 'unknown' ? 'outcome-unknown' : null;
        } catch { /* Ambiguous transport failure is never evidence of non-acceptance. */ }
        try { await store.finish(uid, target.key, attempt, state, code); }
        catch {
          // A 200 from the provider followed by a failed save is still unknown to the ledger.
          // If this save also fails, persisted sending is recovered as unknown after its lease.
          await store.finish(uid, target.key, attempt, 'unknown', 'outcome-unknown');
        }
      }
    }
    return { dryRun, candidates, attempted };
  };
}
