import type { CalendarErrorCode, CalendarItem, CalendarReport, DeadlineEvent, Observation, ObservationResult } from '../../../core/src/types.js';

export interface CalendarTarget { apply(item: CalendarItem): Promise<void> }
export interface CalendarSyncSource {
  pending(): Promise<CalendarItem[]>;
  report(report: CalendarReport): Promise<void>;
}
export class CalendarFailure extends Error {
  constructor(readonly code: CalendarErrorCode) { super(code); }
}
export function createCalendarSync(source: CalendarSyncSource, target: CalendarTarget) {
  let running: Promise<void> | undefined;
  async function drain() {
    // A follow-up read also handles restoration after a completed deletion.
    for (let round = 0; round < 10; round++) {
      const items = await source.pending();
      if (!items.length) return;
      let failure: CalendarErrorCode | null = null;
      for (const item of items) {
        let errorCode: CalendarErrorCode | null = null;
        try { await target.apply(item); }
        catch (error) { errorCode = error instanceof CalendarFailure ? error.code : 'network-error'; failure = errorCode; }
        await source.report({ itemKey: item.itemKey, generation: item.generation, eventId: item.eventId,
          revision: item.desiredRevision, errorCode });
        if (errorCode === 'authorization-required') throw new CalendarFailure(errorCode);
      }
      if (failure) throw new CalendarFailure(failure);
    }
    throw new CalendarFailure('calendar-unavailable');
  }
  return () => running ??= drain().finally(() => { running = undefined; });
}

type CalendarResponse = { status: number; data?: unknown };
export type CalendarRequest = (path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: object) => Promise<CalendarResponse>;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function check(status: number) {
  if (status >= 200 && status < 300) return;
  throw new CalendarFailure(status === 401 || status === 403 ? 'authorization-required' : 'calendar-unavailable');
}
function owned(data: unknown, item: CalendarItem) {
  const value = record(data);
  const marker = record(record(value['extendedProperties'])['private']);
  return value['id'] === item.eventId && marker['itemKey'] === item.itemKey && marker['generation'] === String(item.generation);
}
function matches(data: unknown, event: DeadlineEvent) {
  const value = record(data);
  const sameTime = (actual: unknown, expected: DeadlineEvent['start']) => {
    const time = record(actual);
    return 'date' in expected ? time['date'] === expected.date
      : typeof time['dateTime'] === 'string' && Date.parse(time['dateTime']) === Date.parse(expected.dateTime);
  };
  return value['status'] !== 'cancelled' && value['summary'] === event.summary && value['description'] === event.description &&
    value['transparency'] === event.transparency && sameTime(value['start'], event.start) && sameTime(value['end'], event.end) &&
    record(value['reminders'])['useDefault'] === event.reminders.useDefault &&
    (event.reminders.useDefault || !Array.isArray(record(value['reminders'])['overrides']) ||
      (record(value['reminders'])['overrides'] as unknown[]).length === 0);
}
export function googleCalendarTarget(request: CalendarRequest): CalendarTarget {
  return { async apply(item) {
    if (!item.calendarId) throw new CalendarFailure('calendar-unavailable');
    const collection = `/calendars/${encodeURIComponent(item.calendarId)}/events`;
    const path = `${collection}/${encodeURIComponent(item.eventId)}`;
    const found = await request(path, 'GET');
    const absent = found.status === 404 || found.status === 410 || record(found.data)['status'] === 'cancelled';
    if (item.desired.state === 'deleted') {
      if (absent) return;
      check(found.status);
      if (!owned(found.data, item)) throw new CalendarFailure('event-conflict');
      const removed = await request(path, 'DELETE');
      if (removed.status !== 404 && removed.status !== 410) check(removed.status);
      return;
    }
    const body = { id: item.eventId, ...item.desired.event,
      extendedProperties: { private: { itemKey: item.itemKey, generation: String(item.generation) } } };
    if (!absent) {
      check(found.status);
      if (!owned(found.data, item)) throw new CalendarFailure('event-conflict');
      if (matches(found.data, item.desired.event)) return;
    } else if (found.status !== 404) {
      // A deleted Google event ID cannot safely be reused.
      throw new CalendarFailure('event-conflict');
    }
    const written = await request(absent ? collection : path, absent ? 'POST' : 'PUT', body);
    if (written.status !== 409) check(written.status);
    const confirmed = await request(path, 'GET');
    check(confirmed.status);
    if (!owned(confirmed.data, item) || !matches(confirmed.data, item.desired.event)) throw new CalendarFailure('event-conflict');
  } };
}

/** The collector calls this boundary after building a credential-free observation. */
export async function sendObservationAndSync(observation: Observation,
  send: (observation: Observation) => Promise<ObservationResult>, sync: () => Promise<void>): Promise<ObservationResult> {
  const result = await send(observation);
  // A sync failure must not turn an accepted observation into a failed upload.
  await sync().catch(() => undefined);
  return result;
}
