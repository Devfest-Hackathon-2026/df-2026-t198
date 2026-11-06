import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from 'firebase/auth';
import type { ManualAssignment } from '../../core/src/types';
import { ManualAssignments, ManualAssignmentRow, manualAssignmentActions } from './manual-assignments';
import { StudentView } from './student';
import { assignment, dated, studentFixture } from './student-fixture';
import { emptySession, sessionDeadlineEntries } from './session-model';
import { deadlineEntries, entryTitle } from './deadline-entries';
const row: ManualAssignment = { manualAssignmentId: 'fictional-id', title: '架空の紙の課題', date: '2026-11-09', time: null,
  course: { system: 'demo-lms', courseId: 'math' }, courseName: '架空の線形代数', memo: '<架空のメモ>',
  createdBy: 'supporter-a', createdByRole: 'supporter', createdAt: '2026-11-07T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'fictional' };
const actions = { add: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
it('shows author, escaped memo and date-only precision without an LMS link', () => {
  const html = renderToStaticMarkup(<ManualAssignmentRow row={row} own actions={actions} />);
  expect(html).toContain('手で入れた課題（支援担当が入れました）');
  expect(html).toContain('日付のみ'); expect(html).toContain('&lt;架空のメモ&gt;');
  expect(html).toContain('架空の紙の課題を消す');
  expect(html).not.toMatch(/LMSで見る|23:59/);
});
it('only offers removal to the owner or the actual author and omits cancelled tasks', () => {
  const render = (own: boolean, viewerUid: string) => renderToStaticMarkup(<ManualAssignmentRow row={row} own={own} viewerUid={viewerUid} actions={actions} />);
  expect(render(false, 'supporter-b')).not.toContain('<button');
  expect(render(false, 'supporter-a')).toContain('<button'); expect(render(true, 'student')).toContain('<button');
  expect(renderToStaticMarkup(<ManualAssignments rows={[{ ...row, status: 'cancelled' }]} courses={[]} own />)).not.toContain(row.title);
});
it('offers addition even before any LMS courses or assignments exist', () => {
  const html = renderToStaticMarkup(<ManualAssignments rows={[]} courses={[]} own actions={actions} />);
  expect(html).toContain('課題を手で入れる'); expect(html).toContain('課題の名前');
  expect(html).toContain('授業を選ばない'); expect(html).toContain('締切の時刻（任意）');
});
it('puts manual deadlines alongside LMS tasks in upcoming order and in the correct timetable course', () => {
  const data = { ...studentFixture(), manualAssignments: [row] };
  const html = renderToStaticMarkup(<StudentView data={data} />);
  const upcoming = html.match(/<section class="upcoming"[^>]*>(.*?)<\/section>/)![1]!;
  expect(upcoming.indexOf('架空の紙の課題')).toBeLessThan(upcoming.indexOf('レポートA'));
  expect(html.match(/<small>手で入れた課題<\/small>/g)).toHaveLength(2);
});
it('includes date-only deadlines through the next session, but excludes deleted, old and later deadlines', () => {
  const data = { ...emptySession(), manualAssignments: [row, { ...row, manualAssignmentId: 'later', date: '2026-11-11' },
    { ...row, manualAssignmentId: 'old', date: '2026-11-07' }, { ...row, manualAssignmentId: 'gone', status: 'cancelled' as const }],
    context: { lastSessionAt: null, nextSessionAt: '2026-11-10T10:00:00+09:00' } };
  expect(sessionDeadlineEntries(data, new Date('2026-11-08T10:00:00+09:00')).map(entryTitle)).toEqual([row.title]);
  expect(sessionDeadlineEntries({ ...data, context: { lastSessionAt: null, nextSessionAt: null } }, new Date())).toEqual([]);
});

afterEach(() => vi.unstubAllGlobals());
it('distinguishes invalid input from retryable request failures', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 400 }).mockResolvedValueOnce({ ok: false, status: 500 });
  vi.stubGlobal('fetch', fetch);
  const user = { getIdToken: async () => 'fictional-test-token' } as User;
  const api = manualAssignmentActions(user, 'fictional-student');
  const input = { title: row.title, date: row.date, time: row.time, course: row.course, memo: row.memo };
  await expect(api.add('fictional-id', input)).rejects.toThrow('invalid-input');
  await expect(api.add('fictional-id', input)).rejects.toThrow('request-failed');
});

it('excludes ended LMS tasks from both deadline lists while keeping overdue manual tasks in the student list', () => {
  const ended = assignment('架空の終了したLMS課題', dated('2026-11-09'), { presenceState: 'ended' });
  const overdue = { ...row, date: '2026-11-06' };
  const data = { ...studentFixture(), assignments: [ended], manualAssignments: [overdue] };
  expect(deadlineEntries(data.assignments, data.manualAssignments).map(entryTitle)).toEqual([row.title]);
  const html = renderToStaticMarkup(<StudentView data={data} now={Date.parse('2026-11-08T10:00:00+09:00')} />);
  expect(html).toContain(row.title);
  expect(html).not.toContain(ended.latest.title);
  const session = { ...emptySession(), assignments: [ended], manualAssignments: [row],
    context: { lastSessionAt: null, nextSessionAt: '2026-11-10T10:00:00+09:00' } };
  expect(sessionDeadlineEntries(session, new Date('2026-11-08T10:00:00+09:00')).map(entryTitle)).toEqual([row.title]);
});
