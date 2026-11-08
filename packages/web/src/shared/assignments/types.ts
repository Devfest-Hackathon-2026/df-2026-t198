import type { Course, FetchState, LedgerAssignment, LmsSystem, PreparationPlan, ManualAssignment } from '../../../../core/src/types';

export type StudentCourse = Course & { system: LmsSystem };
export interface StudentData {
  courses: StudentCourse[];
  assignments: LedgerAssignment[];
  fetchStates: FetchState[];
  online: boolean;
  plans: PreparationPlan[];
  manualAssignments: ManualAssignment[];
}
