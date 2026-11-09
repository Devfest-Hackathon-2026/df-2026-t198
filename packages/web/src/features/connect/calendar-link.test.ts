import { expect, it } from 'vitest';
import type { CalendarIntegration, CalendarItem } from '../../../../core/src/types';
import { calendarState } from './calendar-link';

const integration: CalendarIntegration = { mode: 'google', executor: 'extension', calendarId: 'fictional@group.calendar.google.com', connectionState: 'connected' };
const item = (change: Partial<CalendarItem> = {}): CalendarItem => ({ itemKey: 'a'.repeat(64), kind: 'deadline',
  sourceKey: { system: 'demo-lms', sourceId: 'task' }, calendarId: integration.calendarId, eventId: 'abcde', generation: 1,
  desiredRevision: 2, desired: { state: 'deleted' }, appliedRevision: 2, appliedAt: null, lastAttemptedAt: null, lastErrorCode: null, ...change });

it('tells apart not connected, waiting, connected, reconnection and failure', () => {
  expect(calendarState(null, [item({ calendarId: null, appliedRevision: 0 })])).toBe('not-connected');
  expect(calendarState({ ...integration, mode: 'mock', executor: 'demo' }, [])).toBe('not-connected');
  expect(calendarState(integration, [])).toBe('connected');
  expect(calendarState(integration, [item()])).toBe('connected');
  // Saved while Chrome was closed: the extension has not written this revision yet.
  expect(calendarState(integration, [item(), item({ appliedRevision: 1 })])).toBe('pending');
  expect(calendarState(integration, [item({ appliedRevision: 1, lastErrorCode: 'network-error' })])).toBe('failed');
  expect(calendarState(integration, [item({ appliedRevision: 1, lastErrorCode: 'event-conflict' })])).toBe('failed');
  expect(calendarState({ ...integration, connectionState: 'recovery-required' }, [item()])).toBe('failed');
  expect(calendarState(integration, [item({ appliedRevision: 1, lastErrorCode: 'authorization-required' })])).toBe('reconnect');
  expect(calendarState({ ...integration, connectionState: 'reauthorization-required' }, [item({ appliedRevision: 1, lastErrorCode: 'network-error' })])).toBe('reconnect');
  // An error left on an event that has since been written is history, not a failure.
  expect(calendarState(integration, [item({ lastErrorCode: 'network-error' })])).toBe('connected');
});
