import type { Submission } from './types.js';

/** Intermediate reading results, deliberately separate from Observation. */
export interface ReadCourse {
  courseId: string;
  name: string;
  teacher: string;
  slots: { dayOfWeek: number; period: number }[];
}
export interface ReadAssignment {
  sourceId: string;
  courseId: string;
  title: string;
  dueText: string | null;
  dueAt: string | null;
  submission: Submission;
  statusText: string;
  availabilityText?: string;
}
export type PageReading =
  | { pageType: 'home'; courses: ReadCourse[]; assignments: [] }
  | { pageType: 'materials'; courseId: string; assignments: ReadAssignment[] }
  | { pageType: 'assignment-detail'; assignments: ReadAssignment[] };
export interface ReadingContext {
  courseId?: string;
  sourceId?: string;
  /** University setting, not part of the product definition. */
  utcOffset: string;
}
