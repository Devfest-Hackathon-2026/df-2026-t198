import { useState } from 'react';
import { buildSessionView, preparationCandidates, reviewDescription, type SessionData } from './session-model';

export function SessionPlanning({ data, now }: { data: SessionData; now: Date }) {
  const view = buildSessionView(data, now);
  const [selected, setSelected] = useState('');
  const tasks = [...view.deadlines, ...view.review.filter(row => !view.deadlines.includes(row))];
  const task = tasks.find(row => JSON.stringify(row.key) === selected) ?? tasks[0];
  const candidates = preparationCandidates(data, now).filter(candidate =>
    candidate.assignment.system === task?.key.system && candidate.assignment.sourceId === task.key.sourceId);
  const courses = data.courses.filter(course => course.currentTerm !== false);
  const periods = Math.max(5, ...courses.flatMap(course => course.slots.map(slot => slot.period)));
  const weekOf = (date: string) => {
    const monday = new Date(`${date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  };
  const weeks = [...new Set(candidates.map(candidate => weekOf(candidate.date)))];
  if (!weeks.length) weeks.push(weekOf(now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })));
  const [chosenWeek, setChosenWeek] = useState('');
  const monday = new Date(`${weeks.includes(chosenWeek) ? chosenWeek : weeks[0]}T00:00:00Z`);
  const dates = Array.from({ length: 5 }, (_, i) => {
    const day = new Date(monday); day.setUTCDate(day.getUTCDate() + i); return day.toISOString().slice(0, 10);
  });
  return <div className="session-planning">
    <label className="session-topic">相談する課題
      <select value={task ? JSON.stringify(task.key) : ''} onChange={event => setSelected(event.target.value)}>
        {!tasks.length && <option value="">次回までの課題がありません</option>}
        {tasks.map(row => <option key={JSON.stringify(row.key)} value={JSON.stringify(row.key)}>{row.latest.title}</option>)}
      </select>
    </label>
    {!!view.review.length && <section className="session-decisions" aria-labelledby="session-decisions">
      <h2 id="session-decisions">今日決めること</h2>
      <ul>{view.review.map(row => <li key={JSON.stringify(row.key)}><button
        onClick={() => setSelected(JSON.stringify(row.key))}>{row.latest.title}</button>{' '}
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
            <span className="session-candidate" key={JSON.stringify(candidate)}><strong>候補</strong>{task?.latest.title}</span>)}
        </td>)}
      </tr>)}</tbody>
    </table></div>
    {task && !candidates.length && <p>この課題の候補にできるコマがありません。</p>}
    <p className="muted">授業以外の予定は、学生と確かめてください。</p>
    <div className="session-confirm">
      <button disabled aria-describedby="session-confirm-help">学生に確認を頼む</button>
      <p id="session-confirm-help">確定は学生の画面で行います。確認の依頼は準備中です。</p>
    </div>
  </div>;
}
