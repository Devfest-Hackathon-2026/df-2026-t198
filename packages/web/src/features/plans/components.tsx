import { Button, Field } from '../../shared/ui';
import type { PlanActions } from './api';
import { actionMessage, planActionErrorMessage, planProgress } from './progress';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { preparationPeriodTimes } from '@kadai-hisho/core';
import { useOperationMessage } from '../../shared/ui/operation-messages';
import type { LedgerAssignment, PreparationCandidate, PreparationPlan, PreparationPlanInput } from '../../../../core/src/types';
import { preparationAfterDeadline } from '@kadai-hisho/core';
import './preparation-plans.css';

export function PlanForm({ assignments, candidate, actions, onSaved }: {
  assignments: LedgerAssignment[]; candidate?: PreparationCandidate; actions: PlanActions; onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useOperationMessage();
  const element = useRef<HTMLFormElement>(null);
  const [selectedAssignment, setSelectedAssignment] = useState(JSON.stringify(assignments.find(row =>
    row.submission !== 'submitted' && row.presenceState !== 'cancelled')?.key));
  const [period, setPeriod] = useState(candidate?.period ?? 0);
  const [start, setStart] = useState(candidate ? preparationPeriodTimes[candidate.assignment.system]?.[candidate.period - 1]?.[0] ?? '' : '');
  const [end, setEnd] = useState(candidate ? preparationPeriodTimes[candidate.assignment.system]?.[candidate.period - 1]?.[1] ?? '' : '');
  const system = candidate?.assignment.system ?? assignments.find(row => JSON.stringify(row.key) === selectedAssignment)?.key.system;
  const times = system ? preparationPeriodTimes[system]?.[period - 1] : undefined;
  const mismatch = times && start && end && (start < times[0] || end > times[1] || start >= times[1] || end <= times[0]);
  useEffect(() => {
    if (!candidate) return;
    element.current?.querySelector<HTMLInputElement>('input[name="start"]')?.focus({ preventScroll: true });
    element.current?.scrollIntoView({ block: 'center' });
  }, [candidate]);
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
      element.reset(); setStart(''); setEnd(''); setPeriod(0); attempt.current = null;
      setMessage('準備の予定を入れました。'); onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'plan-after-deadline'
        ? '締切より後の予定は入れられません。締切までの日時を選んでください。'
        : error instanceof Error && error.message === 'plan-conflict'
        ? 'この準備の予定は入れられませんでした。授業のあるコマや過ぎた時刻でないか、予定を外していないか確かめてください。'
        : '保存を確認できませんでした。接続と共有の許可を確かめて、同じ内容でもう一度お試しください。');
    } finally { setBusy(false); }
  }
  if (!choices.length) return null;
  return <form ref={element} className="preparation-form" onChange={() => setMessage('')} onSubmit={event => { void submit(event); }}>
    {candidate ? <p>{candidate.date.replaceAll('-', '/')} {candidate.period}限に準備</p> : <>
      <label>準備する課題<select name="assignment" required onChange={event => setSelectedAssignment(event.target.value)}>{choices.map(row => <option key={JSON.stringify(row.key)}
        value={JSON.stringify(row.key)}>{row.latest.title}</option>)}</select></label>
      <Field label="準備する日" name="date" type="date" required />
      <Field label="時間割の時限" name="period" type="number" min="1" max="24" required onChange={event => setPeriod(Number(event.target.value))} />
    </>}
    <Field label="開始時刻" name="start" type="time" required value={start} onChange={event => setStart(event.target.value)} />
    <Field label="終了時刻" name="end" type="time" required value={end} onChange={event => setEnd(event.target.value)} />
    {mismatch && <p className="notice">{period}限の時刻は{times[0]}〜{times[1]}です。指定した時刻がこのコマからはみ出しています。時限と時刻を確かめてください。</p>}
    <Button type="submit" busy={busy} busyLabel="保存中…">入れる</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}
export function PlanDeadlineWarning({ plan, assignments = [] }: { plan: PreparationPlan; assignments?: LedgerAssignment[] | undefined }) {
  const assignment = assignments.find(row => row.key.system === plan.assignment.system && row.key.sourceId === plan.assignment.sourceId);
  return preparationAfterDeadline(plan.startsAt, assignment?.officialDeadline?.deadline) ? <span className="review-tag">締切より後の予定です</span> : null;
}
export function PlanSummary({ plan, assignments }: { plan: PreparationPlan; assignments?: LedgerAssignment[] | undefined }) {
  return <><strong>準備：{plan.title}</strong><time dateTime={plan.startsAt}>{plan.date.replaceAll('-', '/')}</time><span>{plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}</span>
    <span>{plan.createdByRole === 'supporter' ? '支援担当が入れました' : '学生が入れました'}</span><span>{planProgress(plan)}</span><PlanDeadlineWarning plan={plan} assignments={assignments} /></>;
}
export function PlanCell({ plan, selected, onSelect, assignments }: { plan: PreparationPlan; selected: boolean; onSelect: () => void; assignments?: LedgerAssignment[] | undefined }) {
  return <button className="preparation-cell" title={`準備 ${plan.title}`} aria-pressed={selected} aria-controls="preparation-details" onClick={onSelect}>
    <strong>準備 {plan.title}</strong>
    <PlanDeadlineWarning plan={plan} assignments={assignments} />
    {plan.createdByRole === 'supporter' && <small>支援担当が入れた</small>}
  </button>;
}
export function comparePreparationPlans(a: PreparationPlan, b: PreparationPlan) {
  return a.date.localeCompare(b.date) || Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.planId.localeCompare(b.planId);
}
export function PlanList({ plans, actions, viewerUid, own, assignments }: { plans: PreparationPlan[]; actions?: PlanActions | undefined; viewerUid?: string | undefined; own: boolean; assignments?: LedgerAssignment[] | undefined }) {
  const [busy, setBusy] = useState<{ id: string; action: 'done' | 'later' | 'remove' } | null>(null);
  const [message, setMessage] = useOperationMessage();
  const visible = plans.filter(plan => plan.status !== 'cancelled').sort(comparePreparationPlans);
  if (!visible.length) return message ? <p role="status">{message}</p> : null;
  async function act(plan: PreparationPlan, action: 'done' | 'later') {
    if (!actions?.act || busy) return;
    setBusy({ id: plan.planId, action }); setMessage('');
    try { const result = await actions.act(plan.planId, action, plan.revision); setMessage(actionMessage(result.outcome, result.plan, result.demo)); }
    catch (error) { setMessage(planActionErrorMessage(error, '変更を確認できませんでした。接続と予定を確かめて、もう一度お試しください。')); }
    finally { setBusy(null); }
  }
  async function remove(plan: PreparationPlan) {
    if (!actions || busy) return;
    setBusy({ id: plan.planId, action: 'remove' }); setMessage('');
    try { await actions.remove(plan.planId); setMessage('準備の予定を外しました。'); }
    catch { setMessage('準備の予定を外せたか確認できませんでした。接続と共有の許可を確かめて、もう一度お試しください。'); }
    finally { setBusy(null); }
  }
  return <section className="preparation-list" aria-label="入れた準備の予定"><h2>入れた準備の予定</h2>
    <div className="preparation-list-scroll" tabIndex={0} role="region" aria-label="準備の予定の一覧">
    <ul>{visible.map(plan => <li key={plan.planId}>
      <time dateTime={plan.startsAt}>{Number(plan.date.slice(5, 7))}/{Number(plan.date.slice(8))} {plan.startsAt.slice(11, 16)}〜{plan.endsAt.slice(11, 16)}</time>
      <span>{plan.period}限</span><strong>{plan.title}</strong>
      <span>{plan.createdByRole === 'supporter' ? '支援担当が入れました' : '学生が入れました'}</span>
      <span>{planProgress(plan)}</span>
      <PlanDeadlineWarning plan={plan} assignments={assignments} />
      <div className="preparation-buttons">{own && actions?.act && plan.status === 'active' && <><Button disabled={busy !== null} busy={busy?.id === plan.planId && busy.action === 'done'} busyLabel="記録中…" onClick={() => { void act(plan, 'done'); }}>終わった</Button>
        {Date.parse(plan.startsAt) > Date.now() && <Button disabled={busy !== null} busy={busy?.id === plan.planId && busy.action === 'later'} busyLabel="記録中…" onClick={() => { void act(plan, 'later'); }}>後回し</Button>}</>}
      {actions && (own || plan.confirmedBy === viewerUid) && <Button disabled={busy !== null} busy={busy?.id === plan.planId && busy.action === 'remove'} busyLabel="外しています…"
        aria-label={`${plan.title} ${plan.date} ${plan.period}限の準備を外す`} onClick={() => { void remove(plan); }}>外す</Button>}</div>
    </li>)}</ul></div>{message && <p role="status">{message}</p>}
  </section>;
}
