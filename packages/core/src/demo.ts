import type { Submission } from './types.js';

export interface DemoAccount {
  role: 'student' | 'supporter';
  studentId: string;
}
export interface DemoAssignment {
  sourceId: string;
  title: string;
  dueAt: string;
  submission: Submission;
}
export interface DemoCourse {
  courseId: string;
  name: string;
  teacher: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  period: number;
  assignments: DemoAssignment[];
}
export interface DemoData { courses: DemoCourse[] }
