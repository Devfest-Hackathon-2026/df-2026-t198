import { serverFetch } from '../../shared/network';
import type { User } from 'firebase/auth';
import type { PreparationPlan, PreparationPlanInput } from '../../../../core/src/types';

export interface PlanActionResponse {
  outcome: 'done' | 'moved' | 'no-slot' | 'unchanged';
  plan: PreparationPlan;
  demo: boolean;
}
export class PlanActionError extends Error {
  constructor(message: string, readonly plan?: PreparationPlan) { super(message); }
}
export async function performPlanAction(user: User, id: string, action: 'done' | 'later', revision: number) {
  const response = await serverFetch(`/api/v1/plans/${encodeURIComponent(id)}/${action}?rev=${revision}`, { method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as { plan?: PreparationPlan };
    throw new PlanActionError(response.status === 409 ? 'plan-conflict' : 'plan-action-failed', response.status === 409 ? value.plan : undefined);
  }
  return await response.json() as PlanActionResponse;
}
export interface PlanActions {
  add: (id: string, input: PreparationPlanInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  act?: (id: string, action: 'done' | 'later', revision: number) => Promise<PlanActionResponse>;
}
export function planActions(user: User, student: string): PlanActions {
  const request = async (id: string, input?: PreparationPlanInput) => {
    const response = await serverFetch(`/api/v1/students/${encodeURIComponent(student)}/plans/${id}`, {
      method: input ? 'PUT' : 'DELETE', cache: 'no-store', headers: {
        Authorization: `Bearer ${await user.getIdToken()}`, ...(input ? { 'Content-Type': 'application/json' } : {}),
      }, ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(value.error === 'plan-after-deadline' ? value.error : response.status === 409 ? 'plan-conflict' : 'request-failed');
    }
  };
  return { add: request, remove: id => request(id), act: (id, action, revision) => performPlanAction(user, id, action, revision) };
}
