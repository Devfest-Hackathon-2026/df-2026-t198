import { manualDeadline } from './manual-assignment.js';
import type { Deadline, LedgerAssignment, ManualAssignmentInput } from './types.js';

// Consumers apply their own display/filter rules; unknown LMS dates stay unknown.
export function assignmentDeadline(assignment: LedgerAssignment | ManualAssignmentInput): Deadline | undefined {
  return 'officialDeadline' in assignment ? assignment.officialDeadline?.deadline : manualDeadline(assignment);
}
