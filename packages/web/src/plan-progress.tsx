import { useEffect, useState } from 'react';
import { useOperationMessage } from './operation-messages';
import type { User } from 'firebase/auth';
import type { PreparationPlan } from '../../core/src/types';
import type { StudentData } from './student-data';
import { formatDeadline } from './session-model';
import { LmsSourceLink } from './lms-link';

export interface PlanActionResponse {
  outcome: 'done' | 'moved' | 'no-slot' | 'unchanged';
  plan: PreparationPlan;
  demo: boolean;
}
export function planProgress(plan: PreparationPlan) {
  return plan.status === 'done' ? '終わった（LMSへの提出は別）' : plan.laterResult === 'moved' ? '後回しにした' : '';
}
export function currentPlanMessage(plan: PreparationPlan) {
  if (plan.status === 'done') return 'この準備はもう「終わった」と記録されています。変更していません。';
  if (plan.status === 'cancelled') return 'この準備の予定は外されています。変更していません。';
  return `この準備は「${planProgress(plan) || 'まだ'}」と記録されています（${plan.date.replaceAll('-', '/')} ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)}）。変更していません。`;
}
export function actionMessage(outcome: PlanActionResponse['outcome'], plan?: PreparationPlan, demo = false) {
  if (outcome === 'unchanged') return plan ? currentPlanMessage(plan) : '予定が変わりました。学生の画面で確かめてください。';
  if (outcome === 'done') return '準備が終わりました。LMSへの提出は別に行ってください。';
  if (outcome === 'moved') return '準備の予定を次の空いたコマに動かしました。' + (demo
    ? '体験用の予定を更新しました。' : 'カレンダーの予定は、拡張機能がGoogleにつながると動きます。');
  return '締切より前の空いたコマを確かめられなかったため、準備の予定を動かしませんでした。';
}
class PlanActionError extends Error {
  constructor(message: string, readonly plan?: PreparationPlan) { super(message); }
}
export const planActionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof PlanActionError && error.plan ? currentPlanMessage(error.plan) :
    error instanceof Error && error.message === 'plan-conflict' ? '予定が変わりました。学生の画面で確かめてください。' : fallback;
export async function performPlanAction(user: User, id: string, action: 'done' | 'later', revision: number) {
  const response = await fetch(`/api/v1/plans/${encodeURIComponent(id)}/${action}?rev=${revision}`, { method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as { plan?: PreparationPlan };
    throw new PlanActionError(response.status === 409 ? 'plan-conflict' : 'plan-action-failed', response.status === 409 ? value.plan : undefined);
  }
  return await response.json() as PlanActionResponse;
}
export function NextSubmission({ plan, assignments, courses }: Pick<StudentData, 'assignments' | 'courses'> & { plan?: PreparationPlan | undefined }) {
  if (plan?.status !== 'done') return null;
  const task = assignments.find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
  if (!task || task.submission === 'submitted' || task.presenceState === 'cancelled' || task.presenceState === 'ended') return null;
  const courseName = courses.find(course => course.system === task.key.system && course.courseId === task.latest.courseId)?.name ?? '授業';
  return <section aria-label="次は提出"><h2>次は提出</h2><h3>{courseName}：{task.latest.title}</h3>
    <p>締切 {task.officialDeadline ? formatDeadline(task.officialDeadline.deadline) : 'LMSで確かめてください'}</p>
    <LmsSourceLink item={task} courseName={courseName} label="LMSを開く" />
    <p>提出済みかどうかは、次にLMSを開いたときに確かめます。提出済みと分かると「次は提出」から消えます。</p></section>;
}
export function PlanLinkAction({ user, data }: { user: User; data: Pick<StudentData, 'assignments' | 'courses' | 'plans'> }) {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('id'); const action = query.get('do');
  const rev = query.get('rev') ?? '';
  const [message, setMessage] = useOperationMessage();
  const [retry, setRetry] = useState(0); const [failed, setFailed] = useState(false);
  const [recorded, setRecorded] = useState(false);
  useEffect(() => {
    if (!id || !/^[a-f0-9-]{36}$/.test(id) || (action !== 'done' && action !== 'later') ||
      !/^[1-9]\d*$/.test(rev) || !Number.isSafeInteger(Number(rev))) { setMessage('準備の予定のリンクを確かめてください。'); return; }
    let active = true; setFailed(false); setRecorded(false); setMessage('準備の予定を確かめています…');
    void performPlanAction(user, id, action, Number(rev)).then(result => { if (active) {
      setRecorded(true); setMessage(actionMessage(result.outcome, result.plan, result.demo));
    } })
      .catch((error: unknown) => { if (active) {
        setMessage(planActionErrorMessage(error, 'この予定を変更できませんでした。本人のアカウントか、接続と予定の状態を確かめてください。'));
        setFailed(!(error instanceof Error && error.message === 'plan-conflict'));
      } });
    return () => { active = false; };
  }, [user, id, action, rev, retry]);
  if (!message) return null;
  return <section className="notice" aria-label="準備の予定の操作"><p role="status">{message}</p>
    {recorded && <NextSubmission plan={data.plans.find(plan => plan.planId === id)} assignments={data.assignments} courses={data.courses} />}
    {failed && <button onClick={() => setRetry(retry + 1)}>もう一度試す</button>}<a href="/student">時間割を見る</a></section>;
}
