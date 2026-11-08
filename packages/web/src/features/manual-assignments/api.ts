import type { User } from 'firebase/auth';
import type { ManualAssignmentInput } from '../../../../core/src/types';

export interface ManualAssignmentActions {
  add: (id: string, input: ManualAssignmentInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}
export function manualAssignmentActions(user: User, student: string): ManualAssignmentActions {
  const request = async (id: string, input?: ManualAssignmentInput) => {
    const response = await fetch(`/api/v1/students/${encodeURIComponent(student)}/manual-assignments/${id}`, {
      method: input ? 'PUT' : 'DELETE', cache: 'no-store', headers: {
        Authorization: `Bearer ${await user.getIdToken()}`, ...(input ? { 'Content-Type': 'application/json' } : {}),
      }, ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 400 ? 'invalid-input' : response.status === 409 ? 'conflict' : 'request-failed');
  };
  return { add: request, remove: id => request(id) };
}
