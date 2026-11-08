export interface CourseIdentity { system: string; courseId: string }

export const courseIdentityKey = (course: CourseIdentity) => JSON.stringify([course.system, course.courseId]);

function preferredColor(course: CourseIdentity): number {
  let hash = 2166136261;
  for (const char of courseIdentityKey(course)) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  return ((hash ^ (hash >>> 16)) >>> 0) % 8;
}

/** Assign from the student's full list, before filtering. Only membership changes may recolor courses. */
export function assignCourseColors(courses: readonly CourseIdentity[]): ReadonlyMap<string, number> {
  const colors = new Map<string, number>();
  const used = new Set<number>();
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const ordered = [...courses].sort((a, b) => compare(a.system, b.system) || compare(a.courseId, b.courseId));
  for (const course of ordered) {
    const key = courseIdentityKey(course);
    if (colors.has(key)) continue;
    let color = preferredColor(course);
    if (used.size < 8) while (used.has(color)) color = (color + 1) % 8;
    colors.set(key, color);
    used.add(color);
  }
  return colors;
}
