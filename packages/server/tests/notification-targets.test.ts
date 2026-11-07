import { describe, expect, it } from 'vitest';
import { cloudNotificationsEnabled, notificationMessage, notificationTargets } from '../src/notification-targets.js';
import { notificationFixture, origin } from './notification-fixture.js';

describe('notification windows and latest content (#156 N4)', () => {
  const select = (time: string) => notificationTargets(notificationFixture(), new Date(time), origin);
  it.each([
    ['2030-11-11T07:29:59+09:00', []], ['2030-11-11T07:30:00+09:00', ['morning']],
    ['2030-11-11T07:59:59+09:00', ['morning']], ['2030-11-11T08:00:00+09:00', []],
    ['2030-11-11T12:29:59+09:00', []], ['2030-11-11T12:30:00+09:00', ['reminder']],
    ['2030-11-11T12:59:59+09:00', ['reminder']], ['2030-11-11T13:00:00+09:00', []],
  ])('selects the half-open window at %s', (at, kinds) => {
    expect(select(at).map(t => t.kind)).toEqual(kinds);
  });
  it('finds next-month midnight preparations and renders their actual date', () => {
    const data = notificationFixture(), plan = data.plans[0]!;
    plan.startsAt = '2030-12-01T00:10:00+09:00'; plan.endsAt = '2030-12-01T01:10:00+09:00'; plan.date = '2030-12-01';
    data.assignments[0]!.officialDeadline = null;
    const now = new Date('2030-11-30T23:40:00+09:00');
    const target = notificationTargets(data, now, origin)[0]!;
    expect(target).toMatchObject({ kind: 'reminder', scheduledAt: '2030-11-30T14:40:00.000Z' });
    expect(notificationMessage(data, target, now, origin).text).toContain('2030-12-01 00:10');
    expect(notificationTargets(data, new Date('2030-12-01T00:10:00+09:00'), origin)).toEqual([]);
  });
  it('keys ignore revision/settings version and normalize dates, but change when the start moves', () => {
    const data = notificationFixture(), now = new Date('2030-11-11T12:45:00+09:00');
    const key = notificationTargets(data, now, origin)[0]!.key;
    data.plans[0]!.revision++; data.settings!.version++;
    data.plans[0]!.startsAt = '2030-11-11T04:00:00Z';
    expect(notificationTargets(data, now, origin)[0]!.key).toBe(key);
    data.plans[0]!.startsAt = '2030-11-11T13:10:00+09:00';
    expect(notificationTargets(data, now, origin)[0]!.key).not.toBe(key);
  });
  it('defaults OFF, requires owner binding/migration and excludes demo even with forged cloud settings', () => {
    for (const patch of [{ demo: true }, { settings: undefined }]) {
      expect(cloudNotificationsEnabled({ ...notificationFixture(), ...patch })).toBe(false);
    }
    for (const patch of [{ enabled: false }, { deliveryOwner: 'extension' as const }, { migrationState: 'not-started' as const }, { recipientUid: 'other' }]) {
      const data = notificationFixture(); Object.assign(data.settings!, patch);
      expect(cloudNotificationsEnabled(data)).toBe(false);
    }
  });
  it('does not send empty, ended, cancelled, submitted or completed preparations', () => {
    const now = new Date('2030-11-11T12:30:00+09:00');
    for (const state of ['submitted', 'cancelled', 'ended', 'done'] as const) {
      const data = notificationFixture();
      if (state === 'submitted') data.assignments[0]!.submission = state;
      else if (state === 'done') data.plans[0]!.status = state;
      else data.assignments[0]!.presenceState = state;
      expect(notificationTargets(data, now, origin)).toEqual([]);
    }
    const empty = notificationFixture(); empty.assignments = []; empty.plans = [];
    expect(notificationTargets(empty, new Date('2030-11-11T07:30:00+09:00'), origin)).toEqual([]);
  });
  it('keeps deadline equality/date precision and separates completed preparation from submission', () => {
    const data = notificationFixture(), now = new Date('2030-11-11T07:30:00+09:00');
    data.plans[0]!.status = 'done';
    data.assignments[0]!.officialDeadline!.deadline = { kind: 'datetime', dueAt: now.toISOString(), dueText: '', timeZone: 'Asia/Tokyo' };
    const target = notificationTargets(data, now, origin)[0]!;
    expect(notificationMessage(data, target, now, origin).text).toContain('次は提出');
    expect(notificationTargets(data, new Date(now.getTime() + 1), origin)).toEqual([]);
    data.assignments[0]!.officialDeadline!.deadline = { kind: 'date', date: '2030-11-11', dueText: '', timeZone: 'Asia/Tokyo' };
    expect(notificationMessage(data, target, now, origin).text).toContain('（日付のみ）');
    data.assignments[0]!.submission = 'submitted';
    expect(notificationTargets(data, now, origin)).toEqual([]);
  });
  it('shows the last success, partial/failed state, 72h boundary and missing acquisition history', () => {
    const data = notificationFixture(), now = new Date('2030-11-11T07:30:00+09:00');
    const target = notificationTargets(data, now, origin)[0]!;
    const state = data.fetchStates[0]!;
    for (const [age, stale] of [[72 * 3600_000 - 1, false], [72 * 3600_000, true]] as const) {
      state.lastSucceededAt = new Date(now.getTime() - age).toISOString();
      expect(notificationMessage(data, target, now, origin).text.includes('3日以上')).toBe(stale);
    }
    state.lastResult = 'partial';
    expect(notificationMessage(data, target, now, origin).html).toContain('一部だけ取得');
    state.lastResult = 'failed';
    expect(notificationMessage(data, target, now, origin).text).toContain('取得は失敗');
    data.fetchStates = [];
    expect(notificationMessage(data, target, now, origin).text).toContain('取得歴なし');
  });
});
