import { describe, expect, it } from 'vitest';
import { applyObservation } from '../src/ledger.js';
import type { Observation } from '../src/types.js';

const at = '2026-11-06T10:00:00+09:00';
function observation(n: number): Observation {
  return {
    schemaVersion: 1, observationId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    system: 'demo-lms', definitionId: 'demo', definitionVersion: 1, fetchedAt: at,
    catalogCourses: [{ courseId: 'c1', name: '架空の授業', slots: [] }],
    courseResults: [{ courseId: 'c1', listComplete: true, seenSourceIds: ['a1'] }],
    assignments: [{ sourceId: 'a1', courseId: 'c1', title: '架空の課題',
      url: 'https://example.invalid/tasks/a1', submission: 'not-submitted',
      deadline: { kind: 'datetime', dueAt: at, dueText: '11月6日10時', timeZone: 'Asia/Tokyo' } }],
    failures: [],
  };
}
function missing(n: number, complete = true): Observation {
  return { ...observation(n), assignments: [],
    courseResults: [{ courseId: 'c1', listComplete: complete, seenSourceIds: [] }] };
}

describe('observation ledger', () => {
  it('ends only existing tasks, retains evidence and never counts them as missing', () => {
    const first = applyObservation([], observation(1), at);
    const ended = { ...observation(2), assignments: [], courseResults: [{ courseId: 'c1', listComplete: true,
      seenSourceIds: ['a1', 'never-imported'], endedSourceIds: ['a1', 'never-imported'] }] };
    const result = applyObservation(first.assignments, ended, at);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    expect(result.assignments[0]!.officialDeadline).toEqual(first.assignments[0]!.officialDeadline);
    expect(result.changes.map(c => c.kind)).toEqual(['ended']);
    expect(first.assignments[0]!.presenceState).toBe('active');
    const replay = applyObservation(result.assignments, ended, at, result.receipt);
    expect(replay.assignments).toEqual(result.assignments);
    expect(replay.changes).toEqual([]);
    const absent = applyObservation(result.assignments, missing(3), at);
    expect(absent.assignments[0]).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    const unread = applyObservation(absent.assignments, { ...observation(4), assignments: [] }, at);
    expect(unread.assignments[0]!.presenceState).toBe('ended');
    const reopened = applyObservation(unread.assignments, observation(5), at);
    expect(reopened.assignments[0]!.presenceState).toBe('active');
    expect(reopened.changes.map(c => c.kind)).toEqual(['restored']);
  });

  it('ends previously fetched tasks in an out-of-term course without requiring a result', () => {
    const first = applyObservation([], observation(1), at);
    const past = { ...observation(2), fetchedAt: '2026-11-06T10:00:01+09:00', catalogCourses: [{ ...observation(2).catalogCourses[0]!, currentTerm: false }],
      assignments: [], courseResults: [] };
    const result = applyObservation(first.assignments, past, at);
    expect(result.assignments[0]).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    expect(result.changes.map(c => c.kind)).toEqual(['ended']);
  });

  it('keeps a spring-term deadline across September 30 and October 1, then ends it after the deadline', () => {
    const initial = observation(10);
    initial.fetchedAt = '2026-09-30T23:59:00+09:00';
    initial.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2026-10-05T23:59:00+09:00',
      dueText: '10月5日23:59', timeZone: 'Asia/Tokyo' };
    const first = applyObservation([], initial, at);
    const past: Observation = { ...observation(11), fetchedAt: '2026-10-01T00:00:00+09:00',
      catalogCourses: [{ ...initial.catalogCourses[0]!, currentTerm: false }], assignments: [], courseResults: [] };
    const retained = applyObservation(first.assignments, past, at);
    expect(retained.assignments).toEqual(first.assignments);
    expect(retained.changes).toEqual([]);
    const equal = applyObservation(retained.assignments, { ...past, observationId: observation(12).observationId,
      fetchedAt: '2026-10-05T14:59:00Z' }, at);
    expect(equal.assignments[0]!.presenceState).toBe('active');
    const expired = applyObservation(equal.assignments, { ...past, observationId: observation(13).observationId,
      fetchedAt: '2026-10-05T14:59:01Z' }, at);
    expect(expired.assignments[0]).toMatchObject({ presenceState: 'ended', consecutiveMissingCount: 0 });
    expect(expired.assignments[0]!.officialDeadline).toEqual(first.assignments[0]!.officialDeadline);
    expect(expired.assignments[0]!.lastSeenAt).toBe(initial.fetchedAt);
    expect(expired.changes.map(c => c.kind)).toEqual(['ended']);
  });

  it.each([
    ['2026-10-05T14:59:59Z', 'active'],
    ['2026-10-05T15:00:00Z', 'ended'],
  ] as const)('compares date-only deadlines in their timezone at %s', (fetchedAt, presenceState) => {
    const initial = observation(1);
    initial.assignments[0]!.deadline = { kind: 'date', date: '2026-10-05', dueText: '10月5日', timeZone: 'Asia/Tokyo' };
    const first = applyObservation([], initial, at);
    const result = applyObservation(first.assignments, { ...observation(2), fetchedAt,
      catalogCourses: [{ ...initial.catalogCourses[0]!, currentTerm: false }], assignments: [], courseResults: [] }, at);
    expect(result.assignments[0]!.presenceState).toBe(presenceState);
  });

  it.each(['none', 'unreadable'] as const)('ends past-course tasks with no usable official deadline: %s', kind => {
    const initial = observation(1);
    initial.assignments[0]!.deadline = { kind, dueText: '', timeZone: 'Asia/Tokyo' };
    const first = applyObservation([], initial, at);
    const result = applyObservation(first.assignments, { ...observation(2),
      catalogCourses: [{ ...initial.catalogCourses[0]!, currentTerm: false }], assignments: [], courseResults: [] }, at);
    expect(result.assignments[0]!.presenceState).toBe('ended');
  });

  it('uses the verified deadline even if the latest detail could not be read', () => {
    const initial = observation(1);
    initial.assignments[0]!.deadline = { kind: 'datetime', dueAt: '2026-11-10T00:00:00+09:00',
      dueText: '11月10日', timeZone: 'Asia/Tokyo' };
    const first = applyObservation([], initial, at);
    const unread = observation(2);
    unread.assignments[0]!.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
    const next = applyObservation(first.assignments, unread, at);
    const result = applyObservation(next.assignments, { ...observation(3),
      catalogCourses: [{ ...initial.catalogCourses[0]!, currentTerm: false }], assignments: [], courseResults: [] }, at);
    expect(result.assignments[0]!.presenceState).toBe('active');
    expect(result.assignments[0]!.officialDeadline).toEqual(first.assignments[0]!.officialDeadline);
  });

  it('records new assignments, title/deadline changes and submission without mutating input', () => {
    const first = applyObservation([], observation(1), at);
    expect(first.changes.map(c => c.kind)).toEqual(['new']);
    const next = observation(2);
    next.assignments[0]!.title = '課題の新しい題名';
    next.assignments[0]!.deadline = { kind: 'date', date: '2026-11-10', dueText: '11月10日', timeZone: 'Asia/Tokyo' };
    next.assignments[0]!.submission = 'submitted';
    const updated = applyObservation(first.assignments, next, at);
    expect(updated.changes.map(c => c.kind)).toEqual(['title-changed', 'deadline-changed', 'submitted']);
    expect(updated.assignments[0]!.submission).toBe('submitted');
    expect(first.assignments[0]!.latest.title).toBe('架空の課題');
    expect(updated.changes.every(c => c.observationId === next.observationId)).toBe(true);
  });

  it('requires two complete missing lists; incomplete lists do not count; reappearance restores', () => {
    const first = applyObservation([], observation(1), at);
    const once = applyObservation(first.assignments, missing(2), at);
    expect(once.assignments[0]!.presenceState).toBe('cancellation-candidate');
    const incomplete = applyObservation(once.assignments, missing(3, false), at);
    expect(incomplete.assignments[0]!.consecutiveMissingCount).toBe(1);
    const twice = applyObservation(incomplete.assignments, missing(4), at);
    expect(twice.assignments[0]!.presenceState).toBe('cancelled');
    expect(twice.changes.map(c => c.kind)).toEqual(['cancelled']);
    expect(applyObservation(twice.assignments, missing(5), at).changes).toEqual([]);
    const restored = applyObservation(twice.assignments, observation(6), at);
    expect(restored.assignments[0]!.presenceState).toBe('active');
    expect(restored.assignments[0]!.consecutiveMissingCount).toBe(0);
    expect(restored.changes.map(c => c.kind)).toEqual(['restored']);
  });

  it('uses list presence even when detail failed and resets the missing count', () => {
    const first = applyObservation([], observation(1), at);
    const once = applyObservation(first.assignments, missing(2), at);
    const detailFailed = { ...observation(3), assignments: [], failures: [
      { courseId: 'c1', kind: 'parse' as const, detail: 'detail-unavailable' },
    ] };
    const result = applyObservation(once.assignments, detailFailed, at);
    expect(result.assignments[0]).toMatchObject({ presenceState: 'active', consecutiveMissingCount: 0,
      lastSeenObservationId: detailFailed.observationId });
    expect(applyObservation(result.assignments, missing(4), at).assignments[0]!.presenceState)
      .toBe('cancellation-candidate');
  });

  it('does not change ledger, history or missing count on a repeated observation ID', () => {
    const first = applyObservation([], observation(1), at);
    const once = applyObservation(first.assignments, missing(2), at);
    const again = applyObservation(once.assignments, missing(2), at, once.receipt);
    expect(again.assignments).toEqual(once.assignments);
    expect(again.changes).toEqual([]);
    expect(again.receipt).toEqual(once.receipt);
    expect(again.result).toEqual(once.result);
  });

  it('preserves verified deadline and submitted state on unreadable/unknown detail', () => {
    const initial = observation(1);
    initial.assignments[0]!.submission = 'submitted';
    const first = applyObservation([], initial, at);
    const next = observation(2);
    next.assignments[0]!.deadline = { kind: 'unreadable', dueText: '', timeZone: 'Asia/Tokyo' };
    next.assignments[0]!.submission = 'unknown';
    const result = applyObservation(first.assignments, next, at);
    expect(result.assignments[0]!.officialDeadline).toEqual(first.assignments[0]!.officialDeadline);
    expect(result.assignments[0]!.submission).toBe('submitted');
    expect(result.assignments[0]!.reviewReasons.map(r => r.kind)).toEqual(['unreadable-deadline']);
    expect(result.changes).toEqual([]);
    const clear = observation(3);
    clear.assignments[0]!.deadline = { kind: 'none', dueText: '締切なし', timeZone: 'Asia/Tokyo' };
    const cleared = applyObservation(result.assignments, clear, at);
    expect(cleared.assignments[0]!.officialDeadline?.deadline.kind).toBe('none');
    expect(cleared.assignments[0]!.reviewReasons).toEqual([]);
  });

  it('leaves other systems and courses not fetched unchanged', () => {
    const first = applyObservation([], observation(1), at);
    const other = { ...missing(2), system: 'panda' as const };
    expect(applyObservation(first.assignments, other, at).assignments).toEqual(first.assignments);
    expect(applyObservation(first.assignments, { ...missing(2), courseResults: [] }, at).assignments)
      .toEqual(first.assignments);
  });
});
