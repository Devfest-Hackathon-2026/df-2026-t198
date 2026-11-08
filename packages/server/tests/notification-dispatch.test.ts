import { describe, expect, it, vi } from 'vitest';
import type { NotificationStore } from '../src/notifications/store.js';
import { createNotificationDispatch } from '../src/notifications/dispatch.js';
import { notificationFixture, origin } from './notification-fixture.js';

describe('runtime defaults', () => {
  it('does not send or persist when enabled is omitted, even when an adapter is present', async () => {
    const data = notificationFixture();
    const store = { users: async () => [data.uid], read: async () => data,
      recover: vi.fn(), enqueue: vi.fn(), reserve: vi.fn(), start: vi.fn(), finish: vi.fn() } satisfies NotificationStore;
    const send = vi.fn(), resolveRecipient = vi.fn();
    const tick = createNotificationDispatch(store, { origin, sender: { send }, resolveRecipient,
      clock: () => new Date('2030-11-11T07:30:00+09:00') });
    expect(await tick()).toEqual({ dryRun: true, candidates: 1, attempted: 0 });
    expect(send).not.toHaveBeenCalled(); expect(resolveRecipient).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled(); expect(store.recover).not.toHaveBeenCalled();
  });
});
