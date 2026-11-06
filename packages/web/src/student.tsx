import { fetchStatus } from './fetch-status';
import { reviewReasonText } from './review-reason';
import { useEffect, useRef, useState } from 'react';
import type { Deadline, LedgerAssignment } from '../../core/src/types';
import { planActions, PlanCell, PlanForm, PlanList, PlanSummary, type PlanActions } from './preparation-plans';
import { DemoCalendar } from './demo-calendar';
import { ChangedDeadline, useDeadlineChanges } from './deadline-change';
import { DemoLogin } from './demo-login';
import { firebase } from './firebase';
import { watchAccount, type StudentCourse, type StudentData, type StudentState } from './student-data';

export const courseKey = (course: StudentCourse) => JSON.stringify([course.system, course.courseId]);
const belongsTo = (item: LedgerAssignment, course: StudentCourse) =>
  item.key.system === course.system && item.latest.courseId === course.courseId;
const deadlineOf = (item: LedgerAssignment | undefined) => item?.officialDeadline?.deadline;
const dateKey = (deadline: Deadline | undefined) => deadline?.kind === 'datetime' ? Date.parse(deadline.dueAt) :
  deadline?.kind === 'date' ? Date.parse(`${deadline.date}T00:00:00Z`) : Infinity;
export function pending(items: LedgerAssignment[]) {
  return items.filter(item => item.submission !== 'submitted' && item.presenceState !== 'cancelled')
    .sort((a, b) => dateKey(deadlineOf(a)) - dateKey(deadlineOf(b)) || a.latest.title.localeCompare(b.latest.title, 'ja'));
}
export function deadlineText(deadline: Deadline | undefined) {
  if (!deadline || deadline.kind === 'unreadable') return '締切を確認できていません';
  if (deadline.kind === 'none') return '締切なし';
  if (deadline.kind === 'date') return `${Number(deadline.date.slice(5, 7))}/${Number(deadline.date.slice(8))}（日付のみ）`;
  if (deadline.kind !== 'datetime') return '締切を確認できていません';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: deadline.timeZone, month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadline.dueAt));
}
function Review({ item }: { item: LedgerAssignment }) {
  return <>{item.reviewReasons.map((reason, index) => <p className="review" key={index}>
    <span className="badge">要確認</span> {reason.kind === 'unreadable-deadline'
      ? '今回、締切を読めませんでした。前に確認できた締切があれば、そのまま出しています。'
      : reviewReasonText(reason)}</p>)}{item.presenceState === 'cancellation-candidate' &&
      <p className="review"><span className="badge">要確認</span> LMSの一覧で見つかりませんでした。LMSで確かめてください。</p>}</>;
}
function AssignmentRow({ item }: { item: LedgerAssignment }) {
  return <li className="assignment">
    <h3>{item.latest.title}</h3>
    <p><ChangedDeadline value={deadlineText(deadlineOf(item))} /> {item.submission === 'submitted' && <span className="badge done">出せました</span>}
      {item.presenceState === 'cancelled' && <span className="badge">取り消されました</span>}</p>
    <Review item={item} />
    <details><summary>書いてあったこと</summary><p>{deadlineOf(item)?.dueText ?? item.latest.deadline.dueText}</p>
      <p className="muted">{new Date(item.officialDeadline?.fetchedAt ?? item.lastSeenAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 時点</p></details>
    <a href={item.latest.url} target="_blank" rel="noreferrer">LMSで見る ›</a>
  </li>;
}
export function StudentView({ data, now = Date.now(), calendar = false, actions }: { data: StudentData; now?: number; calendar?: boolean; actions?: PlanActions | undefined }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if ((selected || selectedPlanId) && window.matchMedia('(max-width: 850px)').matches) {
      panel.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'start' });
    }
  }, [selected, selectedPlanId]);
  const course = data.courses.find(item => courseKey(item) === selected);
  const upcoming = pending(data.assignments).filter(item => Number.isFinite(dateKey(deadlineOf(item))));
  const plans = data.plans.filter(plan => plan.status === 'active');
  const selectedPlan = plans.find(plan => plan.planId === selectedPlanId);
  const days = Math.max(5, ...plans.map(plan => new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7), ...data.courses.flatMap(c => c.slots.map(s => s.weekday)));
  const periods = Math.max(5, ...plans.map(plan => plan.period), ...data.courses.flatMap(c => c.slots.map(s => s.period)));
  const select = (value: StudentCourse) => { setSelectedPlanId(null); setSelected(courseKey(value)); };
  const unscheduled = data.courses.filter(c => c.slots.length === 0);
  const courseItems = course ? data.assignments.filter(item => belongsTo(item, course)) : [];
  const finished = courseItems.filter(item => item.submission === 'submitted' || item.presenceState === 'cancelled');
  const changed = useDeadlineChanges(new Map(data.courses.map(c => [courseKey(c),
    deadlineText(deadlineOf(pending(data.assignments.filter(item => belongsTo(item, c)))[0]))])));
  const upcomingList = !!upcoming.length && <section className="upcoming" aria-labelledby="upcoming-title"><h2 id="upcoming-title">締切の近い課題</h2>
      <ul>{upcoming.slice(0, 3).map(item => {
        const owner = data.courses.find(c => belongsTo(item, c));
        return <li key={JSON.stringify(item.key)}>{owner ? <button onClick={() => select(owner)} aria-controls="course-assignments">
          <strong>{deadlineText(deadlineOf(item))}</strong> {item.latest.title}<span className="muted">{owner.name}</span>
        </button> : <span>{deadlineText(deadlineOf(item))} {item.latest.title}</span>}</li>;
      })}</ul></section>;
  return <>
    <div className="student-heading"><h1>時間割と課題</h1></div>
    {!data.online && <p role="status" className="notice">接続を確かめています。前に開いたときの内容を表示することがあります。</p>}
    {data.fetchStates.map(state => {
      const last = state.lastSucceededAt;
      const { stale, failed } = fetchStatus(state, now);
      const label = { 'ynu-lms': 'YNU LMS', panda: 'PandA', 'demo-lms': '体験用LMS' }[state.system];
      return stale || failed ? <p className="notice" key={state.system}>
        {label}：{stale ? `最後にLMSから取ったのは${new Date(last!).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}です。LMSを開くと新しくなります。` :
          '一部の課題を確認できていません。LMSを開いて確かめてください。'}</p> : null;
    })}
    {!data.assignments.length && <p className="empty">まだ課題がありません。LMSを開くと、ここに課題が並びます。</p>}
    {calendar ? <DemoCalendar fallback={upcomingList} now={now} /> : upcomingList}
    <div className={`student-layout${course || selectedPlan ? ' with-course' : ''}`}>
      <div><div className="timetable-scroll"><table className="timetable" style={{ minWidth: 44 + days * 120 }}><caption className="sr-only">授業と次の締切</caption>
        <thead><tr><th scope="col">時限</th>{Array.from({ length: days }, (_, d) => <th scope="col" key={d}>{'月火水木金土日'[d]}</th>)}</tr></thead>
        <tbody>{Array.from({ length: periods }, (_, p) => <tr key={p}><th scope="row">{p + 1}限</th>
          {Array.from({ length: days }, (_, d) => <td key={d}>{data.courses.filter(c =>
            c.slots.some(slot => slot.weekday === d + 1 && slot.period === p + 1)).map(c => {
            const next = pending(data.assignments.filter(item => belongsTo(item, c)))[0];
            return <button className={`course-cell${changed.has(courseKey(c)) ? ' changed' : ''}`} key={courseKey(c)} onClick={() => select(c)}
              aria-pressed={courseKey(c) === selected} aria-controls="course-assignments">
              <strong>{c.name}</strong>{next && <><span>{deadlineText(deadlineOf(next))}</span><span>{next.latest.title}</span>
                {(next.reviewReasons.length > 0 || next.presenceState === 'cancellation-candidate') && <span className="review">要確認：{next.reviewReasons[0]?.kind === 'unreadable-deadline'
                  ? '締切を確認できていません。' : next.reviewReasons[0] ? reviewReasonText(next.reviewReasons[0]) : 'LMSの一覧で見つかりませんでした。'}</span>}</>}
            </button>;
          })}{plans.filter(plan => (new Date(`${plan.date}T00:00:00Z`).getUTCDay() || 7) === d + 1 && plan.period === p + 1)
            .map(plan => <PlanCell key={plan.planId} plan={plan} selected={plan.planId === selectedPlanId}
              onSelect={() => { setSelected(null); setSelectedPlanId(plan.planId); }} />)}</td>)}</tr>)}</tbody>
      </table></div>{!!unscheduled.length && <section><h2>曜日・時限のない授業</h2>{unscheduled.map(c =>
        <button className="plain-button" key={courseKey(c)} onClick={() => select(c)} aria-controls="course-assignments">{c.name}</button>)}</section>}</div>
      {course && <aside ref={panel} tabIndex={-1} className="course-panel" id="course-assignments" aria-label={`${course.name}の課題`}>
        <div className="panel-heading"><h2>{course.name}</h2><button onClick={() => setSelected(null)}>閉じる</button></div>
        {!!course.slots.length && <p>{course.slots.map(slot => `${'月火水木金土日'[slot.weekday - 1]}曜${slot.period}限`).join('・')}</p>}
        {course.url && <a href={course.url} target="_blank" rel="noreferrer">LMSで授業を開く</a>}
        <ul>{pending(courseItems).map(item => <AssignmentRow key={JSON.stringify(item.key)} item={item} />)}</ul>
        {!!finished.length && <details className="finished-assignments"><summary>終了した課題</summary>
          <ul>{finished.map(item => <AssignmentRow key={JSON.stringify(item.key)} item={item} />)}</ul></details>}
        {!courseItems.length && <p>この授業の課題はまだありません。</p>}
      </aside>}
      {selectedPlan && <aside ref={panel} tabIndex={-1} className="course-panel preparation-details" id="preparation-details" aria-label="準備の予定の詳細">
        <div className="panel-heading"><h2>準備の予定</h2><button onClick={() => setSelectedPlanId(null)}>閉じる</button></div>
        <PlanSummary plan={selectedPlan} /><span>{selectedPlan.period}限（日本時間）</span>
      </aside>}
    </div>
    {actions && <details className="preparation-add"><summary>準備の予定を入れる</summary>
      <PlanForm assignments={data.assignments} actions={actions} /></details>}
    <PlanList plans={data.plans} actions={actions} own />
  </>;
}
export function StudentPage() {
  const [state, setState] = useState<StudentState>({ status: 'loading' });
  const [authError, setAuthError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => firebase ? watchAccount(firebase.auth, firebase.db, setState) : undefined, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (!firebase) return <><h1>時間割と課題</h1><p>画面の準備中です。しばらくしてから開き直してください。</p></>;
  const client = firebase;
  const accountAction = (action: () => Promise<unknown>) => { setAuthError(false); void action().catch(() => setAuthError(true)); };
  return <>
    {state.status === 'signed-out' ? <><h1>時間割と課題</h1><DemoLogin />
      <button className="plain-button" onClick={() => accountAction(client.login)}>Googleでログイン</button></> :
      <><button className="logout" onClick={() => accountAction(client.logout)}>ログアウト</button>
        {state.status === 'ready' ? <><StudentView key={client.auth.currentUser?.uid} data={state} now={now} calendar
          actions={client.auth.currentUser ? planActions(client.auth.currentUser, client.auth.currentUser.uid) : undefined} />
          {client.auth.currentUser && <a href={`/session/${encodeURIComponent(client.auth.currentUser.uid)}`}>自分の面談日時を見る・変える</a>}</> : <p role="status">{state.status === 'error'
          ? '課題を開けませんでした。接続を確かめて、画面を開き直してください。' : '課題を開いています…'}</p>}</>}
    {authError && <p role="alert">ログイン状態を変更できませんでした。もう一度お試しください。</p>}
  </>;
}
