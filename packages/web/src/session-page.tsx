import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { AssignmentChange, LedgerAssignment, SessionContext } from '../../core/src/types';
import { getSessionServices, type SessionServices } from './session-firebase';
import { buildSessionView, changeDescription, dayInZone, emptySession, formatDeadline, formatMoment,
  reviewDescription, type SessionData } from './session-model';
import { watchSession, type SessionState } from './session-watch';
import './session.css';

export function SessionPage() {
  const [services] = useState(() => { try { return getSessionServices(); } catch { return null; } });
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => services?.observeUser(current => { setUser(current); setReady(true); setError(''); }), [services]);
  if (!services) return <p role="status">面談画面の準備がまだできていません。画面を用意した担当者に確認してください。</p>;
  if (!ready) return <p role="status">ログインを確かめています…</p>;
  return <>
    <div className="session-account">
      <p>学生と一緒に見る画面です</p>
      {user && <button onClick={() => { void services.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')); }}>ログアウト</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {user ? <SessionWorkspace key={user.uid} user={user} services={services} /> : <Login services={services} />}
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
    {services.local && <>
      <label>メールアドレス<input type="email" name="email" autoComplete="username" required /></label>
      <label>パスワード<input type="password" name="password" autoComplete="current-password" required /></label>
    </>}
    <button disabled={busy}>{busy ? 'ログイン中…' : services.local ? 'ログイン' : 'Googleでログイン'}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
function SessionWorkspace({ user, services }: { user: User; services: SessionServices }) {
  const [students, setStudents] = useState<{ uid: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const rows = await services.students(user);
        if (!active) return;
        setStudents(rows); setError('');
        setSelected(current => current && current !== user.uid && !rows.some(r => r.uid === current) ? '' : current);
      } catch {
        if (!active) return;
        setStudents([]); setSelected('');
        setError('担当する学生を開けませんでした。接続とログインを確かめてください。');
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user, services, revision]);
  return <div className="session-shell">
    <aside className="session-sidebar">
      <h2>担当する学生</h2>
      <nav aria-label="担当する学生">
        {students.map(student => <button key={student.uid} aria-pressed={student.uid === selected}
          onClick={() => setSelected(student.uid)}>学生 {student.uid}</button>)}
      </nav>
      <button className="quiet" onClick={() => setRevision(value => value + 1)}>一覧を更新</button>
      <button className="quiet" aria-pressed={selected === user.uid} onClick={() => setSelected(user.uid)}>自分の面談を見る</button>
      {error && <p role="alert">{error}</p>}
    </aside>
    <div className="session-content">
      {selected ? <StudentSession key={selected} uid={selected} user={user} services={services} />
        : <p>面談する学生を選んでください。共有を許可した学生だけを選べます。</p>}
    </div>
  </div>;
}
function StudentSession({ uid, user, services }: { uid: string; user: User; services: SessionServices }) {
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
  return <SessionDetails key={uid} data={state.data} now={now} own={uid === user.uid}
    save={context => services.saveContext(user, uid, context)} />;
}
export function SessionDetails({ data, now, own, save }: { data: SessionData; now: Date; own: boolean;
  save: (context: SessionContext) => Promise<void> }) {
  const view = buildSessionView(data, now);
  const courseName = (row: LedgerAssignment) => data.courses.find(course => course.system === row.key.system &&
    course.courseId === row.latest.courseId)?.name ?? '授業';
  const assignment = (change: AssignmentChange) => data.assignments.find(row =>
    row.key.system === change.assignmentKey.system && row.key.sourceId === change.assignmentKey.sourceId);
  return <>
    <div className="session-heading">
      <div><p className="eyebrow">面談の準備</p><h2>{own ? '自分の面談' : '今日の面談'}</h2></div>
      <div className="session-dates">
        <p>次の面談 <strong>{data.context.nextSessionAt ? formatMoment(data.context.nextSessionAt) : '日時を決めてください'}</strong></p>
        <p>前回 {data.context.lastSessionAt ? formatMoment(data.context.lastSessionAt) : '日時がまだありません'}</p>
        <span className="muted">面談日時は日本時間</span>
      </div>
    </div>
    {!own && <ContextEditor key={`${data.context.lastSessionAt}/${data.context.nextSessionAt}`} context={data.context} save={save} />}
    <div className="session-updates">
      {data.fetchStates.map(state => <p key={state.system}>
        <strong>{({ 'ynu-lms': 'YNU', panda: 'PandA', 'demo-lms': '模擬LMS' })[state.system]}</strong>{' '}
        {state.lastSucceededAt ? `${formatMoment(state.lastSucceededAt)} 時点の情報` : 'まだ更新できていません'}
        {state.lastResult !== 'success' && '。今回すべての課題を確認できませんでした。LMSを一緒に開いて確かめてください。'}
        {state.lastSucceededAt && now.getTime() - Date.parse(state.lastSucceededAt) >= 3 * 86400_000 && '。しばらく更新がありません。'}
      </p>)}
    </div>
    <div className="session-grid">
      <div>
        <section aria-labelledby="session-deadlines"><h2 id="session-deadlines">次の面談までの締切</h2>
          {!data.context.nextSessionAt && <p>次の面談日時を決めると、この期間の締切が出ます。</p>}
          {view.deadlines.length > 0 && <ul className="panel session-rows">{view.deadlines.map(row => <li key={JSON.stringify(row.key)}>
            <p className="eyebrow">{courseName(row)}</p><h3>{row.latest.title}</h3>
            <p className="deadline">{formatDeadline(row.officialDeadline!.deadline)}</p>
            <SourceLink url={row.officialDeadline!.url} />
          </li>)}</ul>}
        </section>
        <section aria-labelledby="session-changes"><h2 id="session-changes">前回の面談からの変化</h2>
          {!data.context.lastSessionAt && <p>前回の面談日時を入れると、それ以降の変化が出ます。</p>}
          {view.changes.length > 0 && <ul className="panel session-rows">{view.changes.map(change => <li key={change.changeId}>
            <time>{formatMoment(change.recordedAt)}</time>
            <h3>{assignment(change)?.latest.title ?? '課題'}</h3><p>{changeDescription(change)}</p>
          </li>)}</ul>}
        </section>
      </div>
      <section className="session-decisions" aria-labelledby="session-decisions"><h2 id="session-decisions">今日決めること</h2>
        {view.review.length > 0 && <ul className="panel session-rows">{view.review.map(row => <li key={JSON.stringify(row.key)}>
          <p className="eyebrow">{courseName(row)}</p><h3>{row.latest.title}</h3>
          <p><span className="review-tag">要確認</span> {reviewDescription(row)}</p>
          {row.officialDeadline && <p>前に確認できた締切：{formatDeadline(row.officialDeadline.deadline)}</p>}
          <SourceLink url={row.latest.url} />
        </li>)}</ul>}
      </section>
    </div>
  </>;
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
