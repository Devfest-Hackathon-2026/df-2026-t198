export interface CourseIdentity { system: string; courseId: string }

/** Hash the identity alone so filtering, ordering and renaming never change a color. */
export function courseColor(course: CourseIdentity | null | undefined): number | undefined {
  if (!course) return undefined;
  let hash = 2166136261;
  for (const char of JSON.stringify([course.system, course.courseId])) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  }
  return ((hash ^ (hash >>> 16)) >>> 0) % 8;
}
