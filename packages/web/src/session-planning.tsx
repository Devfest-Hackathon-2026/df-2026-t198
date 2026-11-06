import { useEffect, useRef, useState } from 'react';
import type { PreparationCandidate } from '../../core/src/types';
import { PlanCell, PlanForm, PlanList, PlanSummary, type PlanActions } from './preparation-plans';
import { buildSessionView, preparationCandidates, reviewDescription, type SessionData } from './session-model';

export function SessionPlanning({ data, now, actions, own = false, viewerUid }: {
  data: SessionData; now: Date; actions?: PlanActions | undefined; own?: boolean; viewerUid?: string | undefined;
}) {
  const [candidate, setCandidate] = useState<PreparationCandidate | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const selectedPlan = data.plans.find(plan => plan.status === 'active' && plan.planId === selectedPlanId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedPlanId) {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedPlanId]);
  const view = buildSessionView(data, now);
  const [selected, setSelected] = useState('');
  const tasks = [...view.deadlines, ...view.review.filter(row => !view.deadlines.includes(row))];
  const task = tasks.find(row => JSON.stringify(row.key) === selected) ?? tasks[0];
  const candidates = preparationCandidates(data, now).filter(candidate =>
    candidate.assignment.system === task?.key.system && candidate.assignment.sourceId === task.key.sourceId &&
    !data.plans.some(plan => plan.status === 'active' && plan.date === candidate.date && plan.period === candidate.period &&
      plan.assignment.system === candidate.assignment.system && plan.assignment.sourceId === candidate.assignment.sourceId));
  const courses = data.courses.filter(course => course.currentTerm !== false);
  const periods = Math.max(5, ...data.plans.filter(plan => plan.status === 'active').map(plan => plan.period), ...courses.flatMap(course => course.slots.map(slot => slot.period)));
  const weekOf = (date: string) => {
    const monday = new Date(`${date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  };
  const weeks = [...new Set([...candidates.map(candidate => weekOf(candidate.date)), ...data.plans.filter(plan => plan.status === 'active').map(plan => weekOf(plan.date))])];
  if (!weeks.length) weeks.push(weekOf(now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })));
  const [chosenWeek, setChosenWeek] = useState('');
  const monday = new Date(`${weeks.includes(chosenWeek) ? chosenWeek : weeks[0]}T00:00:00Z`);
  const dates = Array.from({ length: 5 }, (_, i) => {
    const day = new Date(monday); day.setUTCDate(day.getUTCDate() + i); return day.toISOString().slice(0, 10);
  });
  return <div className="session-planning">
    <label className="session-topic">相談する課題
      <select value={task ? JSON.stringify(task.key) : ''} onChange={event => { setSelected(event.target.value); setCandidate(null); }}>
        {!tasks.length && <option value="">次回までの課題がありません</option>}
        {tasks.map(row => <option key={JSON.stringify(row.key)} value={JSON.stringify(row.key)}>{row.latest.title}</option>)}
      </select>
    </label>
    {!!view.review.length && <section className="session-decisions" aria-labelledby="session-decisions">
      <h2 id="session-decisions">今日決めること</h2>
      <ul>{view.review.map(row => <li key={JSON.stringify(row.key)}><button
        onClick={() => { setSelected(JSON.stringify(row.key)); setCandidate(null); }}>{row.latest.title}</button>{' '}
        <span className="review-tag">要確認</span> {reviewDescription(row)}</li>)}</ul>
    </section>}
    {weeks.length > 1 && <nav className="session-weeks" aria-label="候補のある週">{weeks.map(week =>
      <button key={week} aria-pressed={monday.toISOString().slice(0, 10) === week}
        onClick={() => setChosenWeek(week)}>{week.replaceAll('-', '/')}の週</button>)}</nav>}
    <div className="session-timetable-scroll"><table className="session-timetable">
      <caption>授業と準備の候補</caption>
      <thead><tr><th scope="col">時限</th>{dates.map((date, i) => <th scope="col" key={date}>
        {Number(date.slice(5, 7))}/{Number(date.slice(8))}（{'月火水木金'[i]}）</th>)}</tr></thead>
      <tbody>{Array.from({ length: periods }, (_, i) => <tr key={i}><th scope="row">{i + 1}限</th>
        {dates.map((date, d) => <td key={date}>
          {courses.filter(course => course.slots.some(slot => slot.weekday === d + 1 && slot.period === i + 1))
            .map(course => <span className="session-course" key={JSON.stringify([course.system, course.courseId])}>{course.name}</span>)}
          {candidates.filter(candidate => candidate.date === date && candidate.period === i + 1).map(candidate =>
            <span className="session-candidate" key={JSON.stringify(candidate)}><strong>候補</strong>{task?.latest.title}
              {actions && <button onClick={() => setCandidate(candidate)} aria-label={`${candidate.date} ${candidate.period}限に入れる`}>入れる</button>}</span>)}
          {data.plans.filter(plan => plan.status === 'active' && plan.date === date && plan.period === i + 1).map(plan =>
            <PlanCell key={plan.planId} plan={plan} selected={plan.planId === selectedPlanId}
              onSelect={() => setSelectedPlanId(plan.planId)} />)}
        </td>)}
      </tr>)}</tbody>
    </table></div>
    {selectedPlan && <aside ref={panel} tabIndex={-1} className="course-panel preparation-details" id="preparation-details" aria-label="準備の予定の詳細">
      <div className="panel-heading"><h2>準備の予定</h2><button onClick={() => setSelectedPlanId(null)}>閉じる</button></div>
      <PlanSummary plan={selectedPlan} /><span>{selectedPlan.period}限（日本時間）</span>
    </aside>}
    {task && !candidates.length && <p>この課題の候補にできるコマがありません。</p>}
    <p className="muted">授業以外の予定は、学生と確かめてください。</p>
    {candidate && actions && <PlanForm key={JSON.stringify(candidate)} assignments={data.assignments} candidate={candidate}
      actions={actions} onSaved={() => setCandidate(null)} />}
    <PlanList plans={data.plans} actions={actions} own={own} viewerUid={viewerUid} />
  </div>;
}
