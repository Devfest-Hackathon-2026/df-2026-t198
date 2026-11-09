import { expect, it } from 'vitest';
import type { NotificationController } from '../notifications/settings';
import { connectionSummary } from './settings';
const mail = (enabled: boolean, availability = 'ready', failed = false): NotificationController => ({
  view: { settings: { enabled, version: 1, timeZone: 'Asia/Tokyo', morningTime: '07:30', recipientUid: 'fictional', deliveryOwner: 'cloud', migrationState: 'ready', updatedAt: '' }, availability,
    status: failed ? { state: 'failed', settingsVersion: 1, updatedAt: '', lastAcceptedAt: null, errorCode: 'authorization-required' } : null },
  busy: false, error: '', saved: null, request: async () => {},
});
it('閉じた設定の札でも、通知の有効化と送信可能な状態を区別する', () => {
  const connected = { demo: false, state: 'connected' as const };
  expect(connectionSummary(connected, mail(true), { canManage: true, supporters: [{ uid: 'fictional', revoked: false }] })).toMatchObject({ calendar: '連携済み', email: '受け取り中', share: '共有中', needsSetup: false });
  expect(connectionSummary(connected, mail(true, 'preparing'), undefined).email).toBe('送れません');
  expect(connectionSummary(connected, mail(true, 'ready', true), undefined).email).toBe('送れません');
  expect(connectionSummary(connected, mail(false), undefined).needsSetup).toBe(true);
  expect(connectionSummary({ demo: true, state: 'not-connected' }, mail(false), undefined)).toMatchObject({ calendar: '体験用', email: '見本', needsSetup: false });
  expect(connectionSummary(null, mail(true), null)).toMatchObject({ calendar: '確認できません', share: '確認できません' });
});
