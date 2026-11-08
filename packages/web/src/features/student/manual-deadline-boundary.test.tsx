import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ManualAssignment } from '../../../../core/src/types';
import { StudentView } from './page';
import { SessionDetails } from '../session/page';
import { emptySession } from '../session/model';
import { studentFixture } from '../../shared/testing/student-fixture';

const task: ManualAssignment = { manualAssignmentId: 'boundary', title: '架空の締切境界の課題', date: '2026-11-09', time: '12:00',
  course: null, courseName: null, memo: '残しておくメモ', createdBy: 'student', createdByRole: 'student',
  createdAt: '2026-11-07T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'boundary' };

for (const screen of ['student', 'session'] as const) it.each([
  ['時刻の直前', '12:00', '2026-11-09T11:59:59.999+09:00', false],
  ['時刻と同時', '12:00', '2026-11-09T12:00:00.000+09:00', false],
  ['時刻の直後', '12:00', '2026-11-09T12:00:00.001+09:00', true],
  ['日付のみの当日末尾', null, '2026-11-09T23:59:59.999+09:00', false],
  ['日付のみの翌日', null, '2026-11-10T00:00:00.000+09:00', true],
] as const)(`${screen} %s: 締切後だけ終了欄へ移し、課題とメモを保持する`, (_label, time, at, ended) => {
  const row = { ...task, time };
  const now = new Date(at);
  const student = renderToStaticMarkup(<StudentView data={{ ...studentFixture(), assignments: [], manualAssignments: [row] }} now={now.getTime()} />);
  const session = renderToStaticMarkup(<SessionDetails data={{ ...emptySession(), manualAssignments: [row],
    context: { lastSessionAt: null, nextSessionAt: '2026-11-11T12:00:00+09:00' } }}
    now={now} own={false} uid="student" planning={false} save={async () => {}} />);
  const html = screen === 'student' ? student : session;
  const finished = html.match(/<details class="finished-assignments">(.*?)<\/details>/)?.[1] ?? '';
  expect(finished.includes(task.title)).toBe(ended);
  expect(html).toContain(task.memo);
  expect(html).toContain(task.title);
  if (screen === 'student') expect(student.includes('締切の近い課題')).toBe(!ended);
  else {
    const deadlines = session.match(/<section aria-labelledby="session-deadlines">(.*?)<\/section>/)![1]!;
    expect(deadlines.includes(task.title)).toBe(!ended);
  }
  expect(row.status).toBe('active');
});
