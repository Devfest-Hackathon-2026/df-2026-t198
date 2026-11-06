import { fetchStatus } from './fetch-status';
import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { AssignmentChange, LedgerAssignment, SessionContext } from '../../core/src/types';
import { getSessionServices, type SessionServices } from './session-firebase';
import { buildSessionView, changeDescription, dayInZone, emptySession, formatDeadline, formatMoment,
  reviewDescription, type SessionData } from './session-model';
import { watchSession, type SessionState } from './session-watch';
import { SessionLink, sessionRoute } from './session-route';
import { SessionPlanning } from './session-planning';
import './session.css';
import { ChangedDeadline } from './deadline-change';
import { missingDeadlineText } from './review-reason';
import { DemoLogin } from './demo-login';

export function SessionPage({ path = '/session' }: { path?: string }) {
  const [services] = useState(() => { try { return getSessionServices(); } catch { return null; } });
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => services?.observeUser(current => { setUser(current); setReady(true); setError(''); }), [services]);
  if (!services) return <p role="status">面談画面の準備がまだできていません。画面を用意した担当者に確認してください。</p>;
  if (!ready) return <p role="status">ログインを確かめています…</p>;
  return <>
    <div className="session-account">
      {user && <button className="logout" onClick={() => { void services.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')); }}>ログアウト</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {user ? <SessionWorkspace key={user.uid} user={user} services={services} path={path} /> : <Login services={services} />}
  </>;
}
function Login({ services }: { services: SessionServices }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await services.login(String(form.get('email') ?? ''), String(form.get('password') ?? '')); }
    catch { setError('ログインできませんでした。アカウントと接続を確かめて、もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  return <form className="session-login panel" onSubmit={event => { void login(event); }}>
    <h2>面談にログイン</h2>
    <DemoLogin />
    {services.local && <>
      <label>メールアドレス<input type="email" name="email" autoComplete="username" required /></label>
      <label>パスワード<input type="password" name="password" autoComplete="current-password" required /></label>
    </>}
    <button disabled={busy}>{busy ? 'ログイン中…' : services.local ? 'ログイン' : 'Googleでログイン'}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
function SessionWorkspace({ user, services, path }: { user: User; services: SessionServices; path: string }) {
  const [students, setStudents] = useState<{ uid: string }[] | null>(null);
  const { uid: selected, planning } = sessionRoute(path);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await services.students(user);
        if (!active) return;
        setStudents(rows); setError('');
      } catch {
        if (!active) return;
        setStudents(null);
        setError('担当する学生を開けませんでした。接続とログインを確かめてください。');
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user, services]);
  if (selected) return <div className="session-content">
    <SessionLink className="session-back" href="/session">学生を選び直す</SessionLink>
    <StudentSession key={selected} uid={selected} user={user} services={services} planning={planning} />
  </div>;
  return <section className="session-students">
    <h2>担当する学生</h2>
    <p>学生が見せることにした授業と課題だけを出しています。</p>
    <nav aria-label="担当する学生">
      {students?.map(student => <SessionLink key={student.uid} href={`/session/${encodeURIComponent(student.uid)}`}>
        <strong>学生</strong>{' '}<span className="session-student-id">{student.uid}</span></SessionLink>)}
    </nav>
    {students?.length === 0 && <SessionLink href={`/session/${encodeURIComponent(user.uid)}`}>自分の面談を見る</SessionLink>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
function StudentSession({ uid, user, services, planning }: { uid: string; user: User; services: SessionServices; planning: boolean }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', data: emptySession() });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => watchSession(services.source, uid, user.uid, state => {
    setState(state);
    setNow(new Date());
  }), [services, uid, user.uid]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  if (state.status === 'loading') return <p role="status">面談の内容を開いています…</p>;
  if (state.status === 'denied') return <p role="alert">この学生の共有が終わったか、許可されていません。表示していた内容を消しました。</p>;
  if (state.status === 'error') return <p role="alert">面談の内容を確認できなくなったため、表示を消しました。学生を選び直してください。</p>;
  return <SessionDetails key={uid} data={state.data} now={now} own={uid === user.uid} uid={uid} planning={planning}
    save={context => services.saveContext(user, uid, context)} />;
}
export function SessionDetails({ data, now, own, save, uid, planning }: {
  data: SessionData; now: Date; own: boolean; uid: string; planning: boolean;
  save: (context: SessionContext) => Promise<void> }) {
  const view = buildSessionView(data, now);
  const promises = data.plans.filter(plan => data.context.lastSessionAt &&
    plan.decidedOn === dayInZone(new Date(data.context.lastSessionAt), 'Asia/Tokyo'));
  const changeLine = (change: AssignmentChange) => <>
    <time>{formatMoment(change.recordedAt)}</time>{' '}
    {data.assignments.find(row => sameAssignment(row, change.assignmentKey))?.latest.title ?? '課題'}：{changeDescription(change)}
  </>;
  const base = `/session/${encodeURIComponent(uid)}`;
  return <>
    <header className="session-heading">
      <div><h1>{own ? '自分の面談' : '学生'}</h1>
        {!own && <p className="session-student-id">{uid}</p>}</div>
      <div className="session-dates">
        <p>前回 {data.context.lastSessionAt ? formatMoment(data.context.lastSessionAt) : '日時がまだありません'}</p>
        <p>次回 <strong>{data.context.nextSessionAt ? formatMoment(data.context.nextSessionAt) : '日時を決めてください'}</strong></p>
      </div>
    </header>
    <nav className="session-steps" aria-label="面談の段階">
      <SessionLink href={base} aria-current={!planning ? 'step' : undefined}>① 確かめる</SessionLink>
      <span aria-hidden="true">→</span>
      <SessionLink href={`${base}/plan`} aria-current={planning ? 'step' : undefined}>② 相談する</SessionLink>
    </nav>
    {!own && <ContextEditor key={`${data.context.lastSessionAt}/${data.context.nextSessionAt}`} context={data.context} save={save} />}
    {planning ? <SessionPlanning data={data} now={now} /> : <>
      <div className="session-updates">
        {data.fetchStates.map(state => {
          const { stale, failed } = fetchStatus(state, now.getTime());
          const label = { 'ynu-lms': 'YNU LMS', panda: 'PandA', 'demo-lms': '体験用LMS' }[state.system];
          if (stale || failed) return <p className="notice" key={state.system}>
            {label}：{stale ? `最後にLMSから取ったのは${new Date(state.lastSucceededAt!).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}です。学生がLMSを開くと新しくなります。` :
              '今回すべての課題を確認できませんでした。LMSを一緒に開いて確かめてください。'}</p>;
          return <p key={state.system}>
            <strong>{state.system === 'ynu-lms' ? 'YNU' : label}</strong>{' '}
            {state.lastSucceededAt ? `${formatMoment(state.lastSucceededAt)} 時点の情報` : 'まだ更新できていません'}
          </p>;
        })}
      </div>
      <div className="session-check">
        {!!promises.length && <section aria-labelledby="session-promises"><h2 id="session-promises">前回の約束</h2>
          <ul className="panel session-rows">{promises.map((plan, i) =>
            <li key={i}>{data.assignments.find(row => sameAssignment(row, plan.assignment))?.latest.title ?? '課題'}：
              {plan.date.replaceAll('-', '/')} {plan.period}限に準備</li>)}</ul>
        </section>}
        <section aria-labelledby="session-changes"><h2 id="session-changes">前回の面談からの変化</h2>
          {!data.context.lastSessionAt && <p>前回の面談日時を入れると、それ以降の変化が出ます。</p>}
          {!!view.changes.length && <ul className="panel session-rows session-brief">{view.changes.slice(0, 5).map(change => <li key={change.changeId}>
            {changeLine(change)}
          </li>)}</ul>}
          {view.changes.length > 5 && <details><summary>ほかの変化</summary><ul className="panel session-rows session-brief">
            {view.changes.slice(5).map(change => <li key={change.changeId}>{changeLine(change)}</li>)}
          </ul></details>}
        </section>
        <section aria-labelledby="session-deadlines"><h2 id="session-deadlines">次の面談までの締切</h2>
          {!data.context.nextSessionAt && <p>次の面談日時を決めると、この期間の締切が出ます。</p>}
          {!!view.deadlines.length && <ul className="panel session-rows">{view.deadlines.map(row =>
            <SessionAssignment key={JSON.stringify(row.key)} row={row} data={data} />)}</ul>}
        </section>
        {!!view.review.filter(row => !view.deadlines.includes(row)).length && <ul className="panel session-rows session-other-review"
          aria-label="締切を確かめる課題">
          {view.review.filter(row => !view.deadlines.includes(row)).map(row =>
            <SessionAssignment key={JSON.stringify(row.key)} row={row} data={data} />)}
        </ul>}
        <SessionLink className="session-next" href={`${base}/plan`}>準備する時間を相談する →</SessionLink>
      </div>
    </>}
  </>;
}
function sameAssignment(row: LedgerAssignment, key: LedgerAssignment['key']) {
  return row.key.system === key.system && row.key.sourceId === key.sourceId;
}
function SessionAssignment({ row, data }: { row: LedgerAssignment; data: SessionData }) {
  const course = data.courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId);
  const changes = data.changes.filter(change => sameAssignment(row, change.assignmentKey))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const reason = reviewDescription(row);
  return <li><details className="session-task"><summary><div>
    <span className="eyebrow">{course?.name ?? '授業'}</span>
    <h3>{row.latest.title}</h3>
    <ChangedDeadline value={row.officialDeadline ? formatDeadline(row.officialDeadline.deadline) :
      missingDeadlineText(row.latest.deadline) ?? '締切を確認できていません'} />
    {reason && <span className="session-review"><span className="review-tag">要確認</span> {reason}</span>}
  </div></summary><div className="session-task-detail">
    <SourceLink url={row.latest.url} />
    <h4>書いてあったこと</h4><p>{row.latest.deadline.dueText}</p>
    {row.officialDeadline && row.latest.deadline.kind === 'unreadable' && <p>
      前に確認できた締切：{row.officialDeadline.deadline.dueText}</p>}
    {!!changes.length && <><h4>これまでの変更</h4><ul>{changes.map(change => <li key={change.changeId}>
      <time>{formatMoment(change.recordedAt)}</time> {changeDescription(change)}</li>)}</ul></>}
  </div></details></li>;
}
function SourceLink({ url }: { url: string }) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  } catch { return null; }
  return <a href={url} target="_blank" rel="noreferrer">LMSで見る ›</a>;
}
function ContextEditor({ context, save }: { context: SessionContext; save: (context: SessionContext) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const localInput = (value: string | null) => value ? `${dayInZone(new Date(value), 'Asia/Tokyo')}T${new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))}` : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const date = (key: string) => form.get(key) ? `${String(form.get(key))}:00+09:00` : null;
    try { await save({ lastSessionAt: date('last'), nextSessionAt: date('next') }); setMessage('面談日時を保存しました。'); }
    catch { setMessage('面談日時を保存できませんでした。共有の許可と接続を確かめてください。'); }
    finally { setBusy(false); }
  }
  return <details className="session-editor"><summary>面談日時を変える</summary>
    <form onSubmit={event => { void submit(event); }}>
      <label>前回の面談（日本時間）<input name="last" type="datetime-local" defaultValue={localInput(context.lastSessionAt)} /></label>
      <label>次の面談（日本時間）<input name="next" type="datetime-local" defaultValue={localInput(context.nextSessionAt)} /></label>
      <p className="muted">日時が決まっていない欄は空にできます。</p>
      <button disabled={busy}>{busy ? '保存中…' : '面談日時を保存'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
