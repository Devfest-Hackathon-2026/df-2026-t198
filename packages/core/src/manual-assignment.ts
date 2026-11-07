import type { Deadline, ManualAssignmentInput } from './types.js';

export function manualDeadline(assignment: ManualAssignmentInput): Deadline {
  const dueText = `${assignment.date.replaceAll('-', '/')}${assignment.time ? ` ${assignment.time}` : '（日付のみ）'}`;
  return assignment.time === null
    ? { kind: 'date', date: assignment.date, dueText, timeZone: 'Asia/Tokyo' }
    : { kind: 'datetime', dueAt: `${assignment.date}T${assignment.time}:00+09:00`, dueText, timeZone: 'Asia/Tokyo' };
}
