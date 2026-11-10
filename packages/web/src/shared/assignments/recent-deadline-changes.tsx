import type { AssignmentChange, LedgerAssignment } from '../../../../core/src/types';
import type { StudentCourse } from './types';
import { formatDeadline, formatMoment } from './deadline-format';
import { LmsSourceLink } from './lms-link';
import './recent-deadline-changes.css';

export function recentDeadlineChanges(changes: AssignmentChange[], assignments: LedgerAssignment[], now: number) {
  const key = (value: AssignmentChange['assignmentKey']) => JSON.stringify([value.system, value.sourceId]);
  const active = new Map(assignments.filter(row => row.submission !== 'submitted' &&
    row.presenceState !== 'cancelled' && row.presenceState !== 'ended').map(row => [key(row.key), row]));
  const seen = new Set<string>();
  return changes.filter(change => change.kind === 'deadline-changed' &&
    Date.parse(change.recordedAt) >= now - 7 * 86400_000 && Date.parse(change.recordedAt) <= now)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || b.changeId.localeCompare(a.changeId))
    .flatMap(change => {
      const id = key(change.assignmentKey), assignment = active.get(id);
      if (!assignment || seen.has(id)) return [];
      seen.add(id);
      return [{ change, assignment }];
    });
}

export function RecentDeadlineChanges({ changes = [], assignments, courses, now }: {
  changes?: AssignmentChange[] | undefined; assignments: LedgerAssignment[]; courses: StudentCourse[]; now: number;
}) {
  const rows = recentDeadlineChanges(changes, assignments, now);
  if (!rows.length) return null;
  const value = (deadline: AssignmentChange['before']) => deadline && typeof deadline !== 'string'
    ? formatDeadline(deadline) : '記録なし';
  const renderRow = ({ change, assignment }: typeof rows[number]) => {
    const course = courses.find(item => item.system === assignment.key.system && item.courseId === assignment.latest.courseId);
    return <li key={change.changeId}>
      <p><span>{course?.name ?? '授業'}</span> <strong>{assignment.latest.title}</strong></p>
      <p><span>変更前：{value(change.before)}</span><br /><strong>変更後：{value(change.after)}</strong></p>
      <p className="muted"><time dateTime={change.recordedAt}>{formatMoment(change.recordedAt)}</time>に記録</p>
      <LmsSourceLink item={assignment} courseName={course?.name ?? '授業'} label="LMSで課題を確かめる" />
    </li>;
  };
  return <section className="recent-deadline-changes" aria-label="最近の締切変更">
    <h2>最近の締切変更（{rows.length}件）</h2>
    <p>過去7日間に記録した変更です。課題ごとに最後の変更を表示しています。</p>
    <ul>{rows.slice(0, 1).map(renderRow)}</ul>
    {rows.length > 1 && <details><summary>ほかの締切変更（{rows.length - 1}件）</summary>
      <ul>{rows.slice(1).map(renderRow)}</ul></details>}
  </section>;
}
