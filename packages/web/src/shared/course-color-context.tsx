import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { assignCourseColors, courseIdentityKey, type CourseIdentity } from './course-color';

const CourseColors = createContext<ReadonlyMap<string, number>>(new Map());

export function CourseColorProvider({ courses, children }: { courses: readonly CourseIdentity[]; children: ReactNode }) {
  const colors = useMemo(() => assignCourseColors(courses), [courses]);
  return <CourseColors value={colors}>{children}</CourseColors>;
}

export function useCourseColors() {
  const colors = useContext(CourseColors);
  return (course: CourseIdentity | null | undefined) => course ? colors.get(courseIdentityKey(course)) : undefined;
}
