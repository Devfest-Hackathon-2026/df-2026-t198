import type { Observation } from '../../core/src/types.js';
/** Counts only, for checking a real fetch by hand. Holds no course, assignment, or session values. */
export function observationSummary(observation: Observation) {
  const failures: Record<string, number> = {};
  for (const f of observation.failures) failures[`${f.kind}:${f.detail}`] = (failures[`${f.kind}:${f.detail}`] ?? 0) + 1;
  return {
    courses: observation.catalogCourses.length,
    coursesComplete: observation.courseResults.filter(result => result.listComplete).length,
    listed: observation.courseResults.reduce((sum, result) => sum + result.seenSourceIds.length, 0),
    read: observation.assignments.length,
    unreadableDeadlines: observation.assignments.filter(a => a.deadline.kind === 'unreadable').length,
    failures,
    // Anonymous entries retain each failed course's kinds without its ID or name.
    courseFailures: observation.courseResults.map(result => {
      const counts: Record<string, number> = {};
      for (const f of observation.failures.filter(f => f.courseId === result.courseId)) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      return counts;
    }).filter(counts => Object.keys(counts).length > 0),
  };
}
