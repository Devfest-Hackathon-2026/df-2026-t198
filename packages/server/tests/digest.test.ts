import { describe, expect, it } from 'vitest';
import type { LedgerAssignment, PreparationPlan } from '@kadai-hisho/core';
import { buildDigest } from '../src/digest.js';
const now = new Date('2030-11-10T15:30:00Z'); // Monday 00:30 JST
const row = (id: string, dueAt = '2030-11-13T00:30:00+09:00'): LedgerAssignment => ({
  key: { system: 'ynu-lms', sourceId: id }, latest: { sourceId: id, courseId: 'c1', title: '<課題&ノート>', url: 'https://lms.example.invalid/task?id=1',
    deadline: { kind: 'datetime', dueAt, timeZone: 'Asia/Tokyo', dueText: 'DO NOT COPY ANSWER OR BODY' }, submission: 'not-submitted' },
  officialDeadline: { deadline: { kind: 'datetime', dueAt, timeZone: 'Asia/Tokyo', dueText: 'DO NOT COPY ANSWER OR BODY' }, url: 'https://lms.example.invalid/task', fetchedAt: now.toISOString(), observationId: 'private-id' },
  preparationStartsAt: null, submission: 'not-submitted', submittedAt: null, presenceState: 'active', consecutiveMissingCount: 0,
  lastSeenObservationId: 'private-id', lastSeenAt: now.toISOString(), reviewReasons: [{ kind: 'conflicting-deadline', detail: 'PRIVATE ANNOUNCEMENT' }],
});
const plan = (id = 'p1', date = '2030-11-11'): PreparationPlan => ({ planId: id, assignment: row('task').key,
  title: 'old title', date, period: 3, startsAt: `${date}T13:00:00+09:00`, endsAt: `${date}T14:30:00+09:00`,
  decidedOn: date, timeZone: 'Asia/Tokyo', confirmedBy: 'fictional-supporter', createdByRole: 'supporter', confirmedAt: now.toISOString(),
  status: 'active', revision: 1, calendarItemKey: 'key' });
const courses = [{ system: 'ynu-lms' as const, courseId: 'c1', name: '架空の授業', slots: [] }];
const digest = (plans: PreparationPlan[], assignments: LedgerAssignment[]) => buildDigest('self@example.invalid', plans, assignments, courses, 'https://study.example.invalid', now);
describe('today digest content contract', () => {
  it('uses JST today, actual start time, official deadline and explicit safe fields only', () => {
    const data = digest([plan(), plan('yesterday', '2030-11-10'), plan('tomorrow', '2030-11-12')], [row('task')]);
    expect(data.date).toBe('2030-11-11'); expect(data.to).toBe('self@example.invalid'); expect(data.plans).toHaveLength(1);
    expect(data.plans[0]).toMatchObject({ planId: 'p1', period: 3, startsAt: '2030-11-11T13:00:00+09:00', title: '<課題&ノート>', courseName: '架空の授業', status: 'active' });
    expect(data.text).toContain('今日 3限（13:00〜）');
    expect(data.plans[0]!.doneUrl).toBe('https://study.example.invalid/student/plan?id=p1&do=done');
    expect(data.plans[0]!.laterUrl).toBe('https://study.example.invalid/student/plan?id=p1&do=later');
    expect(data.html).toContain('&lt;課題&amp;ノート&gt;'); expect(data.html).not.toContain('<課題');
    expect(data.plans[0]!.text).toContain('LMSへの提出は別');
    expect(JSON.stringify(data)).not.toMatch(/DO NOT COPY|PRIVATE ANNOUNCEMENT|private-id|confirmedBy|dueText/);
  });
  it('includes both 48h boundaries, excludes past, submitted, cancelled and finished preparation', () => {
    const submitted = { ...row('submitted'), submission: 'submitted' as const };
    const cancelled = { ...row('cancelled'), presenceState: 'cancelled' as const };
    const finished = { ...plan('done'), status: 'done' as const, assignment: row('finished').key };
    const rows = [row('now', now.toISOString()), row('edge'), row('too-late', '2030-11-13T00:30:01+09:00'),
      row('past', '2030-11-11T00:29:59+09:00'), submitted, cancelled, row('finished')];
    rows.forEach(row => { row.latest.title = row.key.sourceId; });
    const data = digest([finished], rows);
    expect(data.assignments.map(task => task.title).sort()).toEqual(['edge', 'now']); expect(data.plans).toHaveLength(0);
  });
  it('date-only deadlines keep their precision and unknown deadlines are not invented', () => {
    const a = row('date'); a.officialDeadline!.deadline = { kind: 'date', date: '2030-11-13', timeZone: 'Asia/Tokyo', dueText: 'private original' };
    const b = row('unknown'); b.officialDeadline = null;
    const data = digest([], [a, b]); expect(data.assignments).toHaveLength(1);
    expect(data.assignments[0]!.deadline).toEqual({ kind: 'date', date: '2030-11-13', timeZone: 'Asia/Tokyo' });
    expect(data.text).toContain('日付のみ'); expect(data.text).not.toContain('23:59');
  });
  it('empty signals do not send when nothing actionable remains', () => {
    expect(digest([], []).empty).toBe(true);
    expect(digest([{ ...plan(), status: 'done' }], [row('task')]).empty).toBe(true);
  });
  it.each(['javascript:alert(1)', 'https://lms.example.invalid/?SID=fictional', 'https://u:p@lms.example.invalid/task'])('refuses unsafe stored links: %s', url => {
    const task = row('task'); task.latest.url = url;
    expect(() => digest([plan()], [task])).toThrow('unsafe-digest-source');
  });
});
