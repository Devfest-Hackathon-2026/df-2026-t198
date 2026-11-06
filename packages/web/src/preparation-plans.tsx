import { actionMessage, performPlanAction, planActionErrorMessage, planProgress } from './plan-progress';
import { useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { LedgerAssignment, PreparationCandidate, PreparationPlan, PreparationPlanInput } from '../../core/src/types';
import './preparation-plans.css';

export interface PlanActions {
  add: (id: string, input: PreparationPlanInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  act?: (id: string, action: 'done' | 'later', revision: number) => Promise<{ outcome: string }>;
}
export function planActions(user: User, student: string): PlanActions {
  const request = async (id: string, input?: PreparationPlanInput) => {
    const response = await fetch(`/api/v1/students/${encodeURIComponent(student)}/plans/${id}`, {
      method: input ? 'PUT' : 'DELETE', cache: 'no-store', headers: {
        Authorization: `Bearer ${await user.getIdToken()}`, ...(input ? { 'Content-Type': 'application/json' } : {}),
      }, ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok) throw new Error(response.status === 409 ? 'plan-conflict' : 'request-failed');
  };
  return { add: request, remove: id => request(id), act: (id, action, revision) => performPlanAction(user, id, action, revision) };
}
export function PlanForm({ assignments, candidate, actions, onSaved }: {
  assignments: LedgerAssignment[]; candidate?: PreparationCandidate; actions: PlanActions; onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const choices = assignments.filter(row => row.submission !== 'submitted' && row.presenceState !== 'cancelled');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const assignment = candidate?.assignment ?? choices.find(row => JSON.stringify(row.key) === form.get('assignment'))?.key;
    if (!assignment) return;
    const date = candidate?.date ?? String(form.get('date'));
    const input: PreparationPlanInput = { assignment, date, period: candidate?.period ?? Number(form.get('period')),
      startsAt: `${date}T${String(form.get('start'))}:00+09:00`, endsAt: `${date}T${String(form.get('end'))}:00+09:00` };
    if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) { setMessage('終了は開始より後の時刻にしてください。'); return; }
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setMessage('');
    try {
      await actions.add(attempt.current.id, input);
      element.reset(); attempt.current = null;
      setMessage('準備の予定を入れました。'); onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'plan-conflict'
        ? 'この準備の予定は入れられませんでした。授業のあるコマや過ぎた時刻でないか、予定を外していないか確かめてください。'
        : '保存を確認できませんでした。接続と共有の許可を確かめて、同じ内容でもう一度お試しください。');
    } finally { setBusy(false); }
  }
  if (!choices.length) return null;
  return <form className="preparation-form" onSubmit={event => { void submit(event); }}>
    {candidate ? <p>{candidate.date.replaceAll('-', '/')} {candidate.period}限に準備</p> : <>
      <label>準備する課題<select name="assignment" required>{choices.map(row => <option key={JSON.stringify(row.key)}
        value={JSON.stringify(row.key)}>{row.latest.title}</option>)}</select></label>
      <label>準備する日<input name="date" type="date" required /></label>
      <label>時間割の時限<input name="period" type="number" min="1" max="24" required /></label>
    </>}
    <p className="muted">カレンダーに入れる時刻を指定してください（日本時間）。授業以外の予定も確かめてください。</p>
    <label>開始時刻<input name="start" type="time" required /></label>
    <label>終了時刻<input name="end" type="time" required /></label>
    <button disabled={busy}>{busy ? '保存中…' : '入れる'}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
export function PlanSummary({ plan }: { plan: PreparationPlan }) {
  return <><strong>準備：{plan.title}</strong><time dateTime={plan.startsAt}>{plan.date.replaceAll('-', '/')}</time><span>{plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}</span>
    <span>{plan.createdByRole === 'supporter' ? '支援担当が入れました' : '学生が入れました'}</span><span>{planProgress(plan)}</span></>;
}
export function PlanCell({ plan, selected, onSelect }: { plan: PreparationPlan; selected: boolean; onSelect: () => void }) {
  return <button className="preparation-cell" aria-pressed={selected} aria-controls="preparation-details" onClick={onSelect}>
    <strong>準備 {plan.title}</strong>
    {plan.createdByRole === 'supporter' && <small>支援担当が入れた</small>}
  </button>;
}
export function PlanList({ plans, actions, viewerUid, own }: { plans: PreparationPlan[]; actions?: PlanActions | undefined; viewerUid?: string | undefined; own: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const visible = plans.filter(plan => plan.status !== 'cancelled');
  if (!visible.length) return null;
  async function act(plan: PreparationPlan, action: 'done' | 'later') {
    if (!actions?.act || busy) return;
    setBusy(plan.planId); setMessage('');
    try { setMessage(actionMessage((await actions.act(plan.planId, action, plan.revision)).outcome)); }
    catch (error) { setMessage(planActionErrorMessage(error, '変更を確認できませんでした。接続と予定を確かめて、もう一度お試しください。')); }
    finally { setBusy(null); }
  }
  async function remove(plan: PreparationPlan) {
    if (!actions || busy) return;
    setBusy(plan.planId); setMessage('');
    try { await actions.remove(plan.planId); setMessage('準備の予定を外しました。'); }
    catch { setMessage('準備の予定を外せたか確認できませんでした。接続と共有の許可を確かめて、もう一度お試しください。'); }
    finally { setBusy(null); }
  }
  return <section className="preparation-list" aria-label="入れた準備の予定"><h2>入れた準備の予定</h2>
    <p>日本時間です。学生はどの準備の予定も外せます。</p>
    {visible.filter(plan => planProgress(plan)).map(plan => <p className="preparation-mobile-progress" key={plan.planId}>{plan.title}：{planProgress(plan)}</p>)}
    <div className="preparation-list-scroll" tabIndex={0} role="region" aria-label="準備の予定の一覧">
    <ul>{visible.map(plan => <li key={plan.planId}>
      <time dateTime={plan.startsAt}>{Number(plan.date.slice(5, 7))}/{Number(plan.date.slice(8))} {plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}</time>
      <span>{plan.period}限</span><strong>{plan.title}</strong>
      <span>{plan.createdByRole === 'supporter' ? '支援担当が入れました' : '学生が入れました'}</span>
      <span>{planProgress(plan)}</span>
      {own && actions?.act && plan.status === 'active' && <><button disabled={busy !== null} onClick={() => { void act(plan, 'done'); }}>終わった</button>
        {Date.parse(plan.startsAt) > Date.now() && <button disabled={busy !== null} onClick={() => { void act(plan, 'later'); }}>後回し</button>}</>}
      {actions && (own || plan.confirmedBy === viewerUid) && <button disabled={busy !== null}
        aria-label={`${plan.title} ${plan.date} ${plan.period}限の準備を外す`} onClick={() => { void remove(plan); }}>外す</button>}
    </li>)}</ul></div>{message && <p role="status">{message}</p>}
  </section>;
}
