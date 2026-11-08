import type { CalendarItem, LedgerAssignment, ManualAssignment } from '@kadai-hisho/core';
import type { StudentCourse } from '../../shared/assignments/types';

/** Resolve saved event identities, never a summary or a possibly duplicate course name. */
export function calendarCourses(items: CalendarItem[], assignments: LedgerAssignment[], courses: StudentCourse[], manual: ManualAssignment[] = []) {
  const result = new Map<string, StudentCourse>();
  for (const item of items) {
    if (item.kind === 'preparation') continue;
    const assignment = assignments.find(row => row.key.system === item.sourceKey.system && row.key.sourceId === item.sourceKey.sourceId);
    const identity = item.kind === 'manual-deadline' && item.sourceKey.system === 'manual'
      ? manual.find(row => row.manualAssignmentId === item.sourceKey.sourceId)?.course
      : assignment && { system: assignment.key.system, courseId: assignment.latest.courseId };
    const course = identity && courses.find(row => row.system === identity.system && row.courseId === identity.courseId);
    if (course) result.set(item.itemKey, course);
  }
  return result;
}
