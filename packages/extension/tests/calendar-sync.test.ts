import { expect, it, vi } from 'vitest';
import { CalendarFailure, createCalendarSync, googleCalendarTarget, sendObservationAndSync, type CalendarRequest } from '../src/calendar-sync.js';
import type { CalendarItem, CalendarReport, Observation } from '../../core/src/types.js';
function item(): CalendarItem {
  return { itemKey: 'a'.repeat(64), sourceKey: { system: 'demo-lms', sourceId: 'task' }, kind: 'deadline', calendarId: 'dedicated',
    eventId: 'abcde', generation: 1, desiredRevision: 1, appliedRevision: 0, appliedAt: null, lastAttemptedAt: null, lastErrorCode: null,
    desired: { state: 'present', event: { summary: '授業：課題', description: '締切とLMSで開く',
      start: { date: '2026-11-12' }, end: { date: '2026-11-13' }, transparency: 'transparent', reminders: { useDefault: true } } } };
}
function fakeCalendar() {
  const events = new Map<string, object>();
  let loseResponse = false;
  const request = vi.fn<CalendarRequest>(async (path, method, body) => {
    const id = path.split('/').at(-1)!;
    if (method === 'GET') return events.has(id) ? { status: 200, data: events.get(id) } : { status: 404 };
    if (method === 'DELETE') { events.delete(id); return { status: 204 }; }
    const eventId = (body as { id: string }).id;
    if (method === 'POST' && events.has(eventId)) return { status: 409 };
    events.set(eventId, structuredClone(body!));
    if (loseResponse) { loseResponse = false; throw new Error('upstream private text'); }
    return { status: 200, data: body };
  });
  return { request, events, loseNextResponse() { loseResponse = true; } };
}
it('creates, moves, removes submitted notifications and deletes without duplicates', async () => {
  const fake = fakeCalendar(); const target = googleCalendarTarget(fake.request); const row = item();
  await target.apply(row); await target.apply(row);
  expect(fake.events.size).toBe(1);
  if (row.desired.state !== 'present') throw new Error();
  row.desired.event.start = { date: '2026-11-14' }; row.desired.event.end = { date: '2026-11-15' };
  row.desired.event.reminders.useDefault = false;
  await target.apply(row);
  expect(fake.events.get('abcde')).toMatchObject({ start: { date: '2026-11-14' }, reminders: { useDefault: false } });
  row.desired = { state: 'deleted' };
  await target.apply(row); await target.apply(row);
  expect(fake.events.size).toBe(0);
  expect(fake.request.mock.calls.filter(c => c[1] === 'POST')).toHaveLength(1);
});
it('recovers a lost insert response by the saved ID, keeping exactly one event', async () => {
  const fake = fakeCalendar(); const target = googleCalendarTarget(fake.request); const row = item();
  fake.loseNextResponse();
  await expect(target.apply(row)).rejects.toThrow();
  expect(fake.events.size).toBe(1);
  await target.apply(row);
  expect(fake.events.size).toBe(1);
  expect(fake.request.mock.calls.filter(c => c[1] === 'POST')).toHaveLength(1);
});
it('does not overwrite or delete an event with a different ownership marker', async () => {
  const fake = fakeCalendar(); const target = googleCalendarTarget(fake.request); const row = item();
  fake.events.set('abcde', { id: 'abcde', summary: 'someone else' });
  await expect(target.apply(row)).rejects.toMatchObject({ code: 'event-conflict' });
  row.desired = { state: 'deleted' };
  await expect(target.apply(row)).rejects.toMatchObject({ code: 'event-conflict' });
  expect(fake.events.size).toBe(1);
});
it('reports fixed errors, leaves failed work pending and serializes concurrent triggers', async () => {
  const row = item(); const reports: CalendarReport[] = [];
  const source = { pending: vi.fn(async () => row.appliedRevision ? [] : [structuredClone(row)]),
    report: vi.fn(async (r: CalendarReport) => { reports.push(r); if (!r.errorCode) row.appliedRevision = r.revision; }) };
  const target = { apply: vi.fn(async () => { throw new Error('private upstream data'); }) };
  const sync = createCalendarSync(source, target);
  await expect(Promise.all([sync(), sync()])).rejects.toMatchObject({ code: 'network-error' });
  expect(target.apply).toHaveBeenCalledTimes(1);
  expect(reports).toEqual([{ itemKey: row.itemKey, generation: 1, eventId: 'abcde', revision: 1, errorCode: 'network-error' }]);
  target.apply.mockResolvedValue(undefined as never);
  await sync();
  expect(row.appliedRevision).toBe(1);
});
it('stops on missing authorization and does not swallow observation upload failures', async () => {
  const row = item(); const report = vi.fn(async () => {});
  const sync = createCalendarSync({ pending: async () => [row, row], report },
    { apply: async () => { throw new CalendarFailure('authorization-required'); } });
  await expect(sync()).rejects.toMatchObject({ code: 'authorization-required' }); expect(report).toHaveBeenCalledTimes(1);
  const after = vi.fn(async () => { throw new Error('sync failed'); });
  const result = { status: 'applied' as const, changed: true, changeCount: 1 };
  await expect(sendObservationAndSync({} as Observation, async () => result, after)).resolves.toEqual(result);
  expect(after).toHaveBeenCalledTimes(1);
  after.mockClear();
  await expect(sendObservationAndSync({} as Observation, async () => { throw new Error('upload'); }, after)).rejects.toThrow('upload');
  expect(after).not.toHaveBeenCalled();
});
