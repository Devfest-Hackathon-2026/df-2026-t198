import { describe, expect, it } from 'vitest';
import type { LedgerAssignment, PreparationPlan } from '@kadai-hisho/core';
import { buildDigest } from '../src/digest.js';
import { mailIsSafe, parseDigest } from '../../extension/src/digest.js';
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
    expect(data.plans[0]!.doneUrl).toBe('https://study.example.invalid/student/plan?id=p1&do=done&rev=1');
    expect(data.plans[0]!.laterUrl).toBe('https://study.example.invalid/student/plan?id=p1&do=later&rev=1');
    expect(data.html).toContain('&lt;課題&amp;ノート&gt;'); expect(data.html).not.toContain('<課題');
    for (const content of [data.text, data.html, data.plans[0]!.text, data.plans[0]!.html]) {
      expect(content).toContain('「終わった」は準備が終わったときに押してください。LMSへの提出は別に行ってください。');
      expect(content).not.toContain('準備の記録');
    }
    expect(JSON.stringify(data)).not.toMatch(/DO NOT COPY|PRIVATE ANNOUNCEMENT|private-id|confirmedBy|dueText/);
  });
  it('includes both 48h boundaries, excludes past, submitted and cancelled but retains unsubmitted work after preparation', () => {
    const submitted = { ...row('submitted'), submission: 'submitted' as const };
    const cancelled = { ...row('cancelled'), presenceState: 'cancelled' as const };
    const ended = { ...row('ended'), presenceState: 'ended' as const };
    const finished = { ...plan('done'), status: 'done' as const, assignment: row('finished').key };
    const rows = [row('now', now.toISOString()), row('edge'), row('too-late', '2030-11-13T00:30:01+09:00'),
      row('past', '2030-11-11T00:29:59+09:00'), submitted, cancelled, ended, row('finished')];
    rows.forEach(row => { row.latest.title = row.key.sourceId; });
    const data = digest([finished], rows);
    expect(data.assignments.map(task => task.title).sort()).toEqual(['edge', 'finished', 'now']); expect(data.plans).toHaveLength(0);
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
    expect(digest([{ ...plan(), status: 'done' }], [row('task')]).empty).toBe(false);
  });
  it.each(['javascript:alert(1)', 'https://lms.example.invalid/?SID=fictional', 'https://u:p@lms.example.invalid/task'])('refuses unsafe stored links: %s', url => {
    const task = row('task'); task.latest.url = url;
    expect(digest([plan()], [task])).toMatchObject({ empty: true, plans: [], assignments: [] });
    expect(digest([plan()], [task, row('safe')]).assignments).toHaveLength(1);
  });
});

it('keeps safe work when one task or course contains unsafe mail text or links', () => {
  for (const unsafe of ['Cookie: invented', 'SID: invented', 'SID%253Dinvented', 'Bearer invented', 'id_token=invented']) {
    const bad = row('bad'); bad.latest.title = unsafe;
    const good = row('task');
    const data = digest([plan(), { ...plan('bad-plan'), assignment: bad.key }], [bad, good]);
    expect(data.plans.map(p => p.planId)).toEqual(['p1']); expect(data.assignments).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(unsafe);
    bad.latest.title = 'normal'; bad.latest.courseId = 'bad-course';
    const other = buildDigest('self@example.invalid', [], [bad, good], [...courses,
      { system: 'ynu-lms', courseId: 'bad-course', name: unsafe, slots: [] }], 'https://study.example.invalid', now);
    expect(other.assignments).toHaveLength(1);
  }
});
it('collapses whitespace in task and course names and distinguishes the per-plan reminder subject', () => {
  const task = row('task'); task.latest.title = '架空\r\nレポート\t  A';
  const data = buildDigest('self@example.invalid', [plan()], [task], [{ ...courses[0]!, name: '架空\n  の授業' }], 'https://study.example.invalid', now);
  expect(data.plans[0]).toMatchObject({ title: '架空 レポート A', courseName: '架空 の授業', subject: '13:00から：架空 レポート Aの準備' });
  expect(data.subject).toBe('今日やること（2030/11/11）');
  expect(data.text).toContain('架空 レポート A'); expect(data.html).toContain('架空 の授業');
  expect(data.html).not.toContain('架空\r');
});

it('produces digest and per-plan mail accepted by the merged extension consumer', () => {
  const unsafe = row('unsafe'); unsafe.latest.title = 'Cookie: fictional';
  const task = row('task'); task.latest.title = '架空の\n課題';
  const data = digest([plan()], [unsafe, task]);
  expect(parseDigest(data, data.date)).toEqual(data);
  expect(mailIsSafe(data, [])).toBe(true);
  expect(mailIsSafe({ ...data.plans[0]!, to: data.to }, [])).toBe(true);
});

it.each(['得点の30% sid%3Dfictional', 'Cookie&#58; 設定'])('omits just the task containing an encoded credential marker: %s', title => {
  const unsafe = row('unsafe'); unsafe.latest.title = title;
  const data = digest([plan()], [unsafe, row('task')]);
  expect(data.assignments).toHaveLength(1);
  expect(data.plans).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain(title);
  expect(mailIsSafe(data, [])).toBe(true);
});
