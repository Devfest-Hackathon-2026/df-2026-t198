import { assignmentDeadline, manualDeadline } from '@kadai-hisho/core';
import type { Deadline, LedgerAssignment, ManualAssignment } from '../../core/src/types';
import type { StudentCourse } from './student-data';

export type DeadlineEntry = { kind: 'lms'; row: LedgerAssignment } | { kind: 'manual'; row: ManualAssignment };
export const entryId = (entry: DeadlineEntry) => entry.kind === 'manual' ? `manual:${entry.row.manualAssignmentId}` : JSON.stringify(entry.row.key);
export const entryTitle = (entry: DeadlineEntry) => entry.kind === 'manual' ? entry.row.title : entry.row.latest.title;
export const entryDeadline = (entry: DeadlineEntry) => assignmentDeadline(entry.row);
export const entryDisplayDeadline = (entry: DeadlineEntry) => entryDeadline(entry) ??
  (entry.kind === 'lms' && entry.row.latest.deadline.kind === 'unreadable' ? entry.row.latest.deadline : undefined);
export function entryBelongsTo(entry: DeadlineEntry, course: StudentCourse) {
  return entry.kind === 'manual' ? entry.row.course?.system === course.system && entry.row.course.courseId === course.courseId
    : entry.row.key.system === course.system && entry.row.latest.courseId === course.courseId;
}
export function deadlineValue(deadline: Deadline | undefined) {
  return deadline?.kind === 'datetime' ? Date.parse(deadline.dueAt)
    : deadline?.kind === 'date' ? Date.parse(`${deadline.date}T00:00:00+09:00`) : Infinity;
}
export function manualAssignmentEnded(row: ManualAssignment, now: number): boolean {
  const deadline = manualDeadline(row);
  if (deadline.kind === 'datetime') return Date.parse(deadline.dueAt) < now;
  if (deadline.kind === 'date') {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: deadline.timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
    return deadline.date < today;
  }
  return false;
}
export function deadlineEntries(assignments: LedgerAssignment[], manual: ManualAssignment[], now = Date.now()): DeadlineEntry[] {
  return [
    ...assignments.filter(row => row.presenceState !== 'cancelled' && row.presenceState !== 'ended' && row.submission !== 'submitted').map(row => ({ kind: 'lms' as const, row })),
    ...manual.filter(row => row.status === 'active' && !manualAssignmentEnded(row, now)).map(row => ({ kind: 'manual' as const, row })),
  ].sort((a, b) => deadlineValue(entryDeadline(a)) - deadlineValue(entryDeadline(b)) || entryTitle(a).localeCompare(entryTitle(b), 'ja'));
}
