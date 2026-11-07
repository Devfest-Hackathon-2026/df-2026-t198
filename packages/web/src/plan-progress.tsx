import { useEffect, useRef, useState } from 'react';
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
  return <section className="next-submission" aria-label="次は提出"><h2>次は提出</h2><h3>{courseName}：{task.latest.title}</h3>
    <p className="submission-deadline">締切 {task.officialDeadline ? formatDeadline(task.officialDeadline.deadline) : 'LMSで確かめてください'}</p>
    <LmsSourceLink item={task} courseName={courseName} label="LMSを開く" />
    <p>提出済みかどうかは、次にLMSを開いたときに確かめます。提出済みと分かると「次は提出」から消えます。</p></section>;
}
type PlanLinkData = Pick<StudentData, 'assignments' | 'courses' | 'plans'>;
export function PlanLinkAction({ user, data, link }: { user: User; data: PlanLinkData; link?: string }) {
  const query = new URLSearchParams(link ? new URL(link, window.location.href).search : window.location.search);
  const id = query.get('id'); const action = query.get('do'); const rev = query.get('rev') ?? '';
  if (!id || !/^[a-f0-9-]{36}$/.test(id) || (action !== 'done' && action !== 'later') ||
    !/^[1-9]\d*$/.test(rev) || !Number.isSafeInteger(Number(rev))) {
    return <section className="notice plan-confirmation" aria-label="準備の予定の操作"><p role="status">準備の予定のリンクを確かめてください。</p><a href="/student">時間割を見る</a></section>;
  }
  return <PlanConfirmation key={`${user.uid}-${id}-${action}-${rev}`} user={user} data={data} id={id} action={action} revision={Number(rev)} />;
}
function PlanConfirmation({ user, data, id, action, revision }: {
  user: User; data: PlanLinkData; id: string; action: 'done' | 'later'; revision: number;
}) {
  const [message, setMessage] = useOperationMessage();
  const [state, setState] = useState<'idle' | 'busy' | 'retry' | 'finished'>('idle');
  const [responsePlan, setResponsePlan] = useState<PreparationPlan>();
  const inFlight = useRef(false); const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const livePlan = data.plans.find(plan => plan.planId === id);
  const plan = responsePlan && (!livePlan || responsePlan.revision >= livePlan.revision) ? responsePlan : livePlan;
  const task = data.assignments.find(row => row.key.system === plan?.assignment.system && row.key.sourceId === plan?.assignment.sourceId);
  const course = data.courses.find(row => row.system === task?.key.system && row.courseId === task?.latest.courseId);
  const stale = plan && plan.revision !== revision;
  const canConfirm = plan?.status === 'active' && !stale && state === 'idle';
  async function confirm() {
    if (inFlight.current || (!canConfirm && state !== 'retry')) return;
    inFlight.current = true; setState('busy'); setMessage('準備の記録を確認しています…');
    try {
      // A retry must use the original link, even if the live plan has moved after a lost response.
      const result = await performPlanAction(user, id, action, revision);
      if (active.current) {
        setResponsePlan(result.plan); setState(result.outcome === 'no-slot' ? 'retry' : 'finished');
        setMessage(actionMessage(result.outcome, result.plan, result.demo));
      }
    } catch (error) {
      if (active.current) {
        if (error instanceof PlanActionError && error.plan) setResponsePlan(error.plan);
        setState(error instanceof Error && error.message === 'plan-conflict' ? 'finished' : 'retry');
        setMessage(planActionErrorMessage(error, '準備の記録を確認できませんでした。接続と本人のアカウントを確かめてから、同じ操作をもう一度試してください。'));
      }
    } finally { inFlight.current = false; }
  }
  return <section className="notice plan-confirmation" aria-label="準備の予定の操作"><h2>準備の記録を確認</h2>
    {plan ? <><h3>{course ? `${course.name}：` : ''}{task?.latest.title ?? plan.title}</h3>
      <p>準備の日時：{plan.date.replaceAll('-', '/')} {plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}（日本時間）</p>
      <p role={message ? undefined : 'status'}>{state === 'idle' ? currentPlanMessage(plan) : `今の状態：${plan.status === 'cancelled' ? '予定を外した' : planProgress(plan) || 'まだ'}`}</p>
      {stale && state === 'idle' && <p>このリンクが作られた後に予定が変わっています。変更していません。時間割で確かめてください。</p>}</> :
      <p role="status">本人の準備の予定を見つけられませんでした。本人のアカウントと時間割を確かめてください。</p>}
    {canConfirm && <p>「{action === 'done' ? '終わった' : '後回し'}」を押すと記録します。LMSへの提出は別に行ってください。</p>}
    {(canConfirm || state === 'busy' || state === 'retry') && <button disabled={state === 'busy'} onClick={() => { void confirm(); }}>
      {state === 'busy' ? '確認中…' : state === 'retry' ? 'もう一度試す' : action === 'done' ? '終わった' : '後回し'}</button>}
    {message && <p role="status">{message}</p>}
    <NextSubmission plan={plan} assignments={data.assignments} courses={data.courses} />
    <a href="/student">時間割を見る</a></section>;
}
