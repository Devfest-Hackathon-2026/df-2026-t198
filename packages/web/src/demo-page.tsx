import { useEffect, useRef, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DemoAccount, DemoData, Observation } from '@kadai-hisho/core';
import { firebase } from './firebase';
import { DemoPages, demoDueText } from './demo-pages';
import { readDemoObservation } from './demo-reader';
import './demo.css';

async function post(user: User, path: string, body: unknown) {
  const response = await fetch(path, { method: 'POST', cache: 'no-store', headers: {
    Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(response.status === 409 ? 'deadline-changed' : 'request-failed');
  return response;
}
export function DemoPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => firebase ? onAuthStateChanged(firebase.auth, setUser) : undefined, []);
  if (!firebase) return <p>体験画面の準備中です。担当者に確認してください。</p>;
  const client = firebase;
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    try { await signInWithEmailAndPassword(client.auth, String(form.get('email')), String(form.get('password'))); }
    catch { setError('ログインできませんでした。アカウントと接続を確かめてください。'); }
  }
  return <div className="demo-shell"><h1>課題の秘書を試す</h1>
    <p>ここで扱う授業と課題は架空のものです。学生と支援担当は別のブラウザでログインしてください。</p>
    {user === undefined ? <p role="status">ログインを確かめています…</p> : user ? <>
      <button onClick={() => { void client.logout().catch(() => setError('ログアウトできませんでした。もう一度お試しください。')); }}>ログアウト</button>
      <DemoWorkspace key={user.uid} user={user} />
    </> : <form className="session-login" onSubmit={event => { void login(event); }}>
      <label>メールアドレス<input name="email" type="email" autoComplete="username" required /></label>
      <label>パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
      <button>ログイン</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
function DemoWorkspace({ user }: { user: User }) {
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [data, setData] = useState<DemoData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let stopData = () => {};
    const fail = () => { if (active) { setAccount(null); setData(null); setFailed(true); stopData(); } };
    const stop = onSnapshot(doc(firebase!.db, 'demoAccounts', user.uid), { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata.fromCache) return;
      stopData(); setData(null);
      const profile = snapshot.data() as DemoAccount | undefined;
      if (!profile || !['student', 'supporter'].includes(profile.role) ||
        (profile.role === 'student' && profile.studentId !== user.uid)) { fail(); return; }
      setAccount(profile); setFailed(false);
      if (profile.role === 'student') stopData = onSnapshot(doc(firebase!.db, 'students', user.uid, 'demo', 'current'),
        { includeMetadataChanges: true }, value => {
          if (!active || value.metadata.fromCache) return;
          if (!value.exists()) { fail(); return; }
          setData(value.data() as DemoData);
        }, fail);
    }, fail);
    return () => { active = false; stop(); stopData(); };
  }, [user.uid]);
  if (failed) return <p role="alert">体験用のデータを開けませんでした。体験用アカウントと接続を確かめてください。</p>;
  if (!account) return <p role="status">体験用のデータを開いています…</p>;
  if (account.role === 'supporter') return <><p>面談画面で、担当する学生を選んでください。</p><a href="/session">面談を開く</a></>;
  return data ? <DemoStudent key={user.uid} user={user} data={data} /> : <p role="status">授業を開いています…</p>;
}
function DemoStudent({ user, data }: { user: User; data: DemoData }) {
  const pages = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<Observation | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function action(run: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setMessage(''); setError('');
    try { const text = await run(); if (active.current) setMessage(text); }
    catch (failure) { if (active.current) setError(failure instanceof Error && failure.message === 'deadline-changed'
      ? '締切がすでに変わっています。今の締切を確かめてください。'
      : '操作が終わりませんでした。接続を確かめて、もう一度お試しください。'); }
    finally { if (active.current) setBusy(false); }
  }
  const open = () => action(async () => {
    pending.current ??= readDemoObservation(pages.current!, window.location.origin, crypto.randomUUID(), new Date().toISOString());
    await post(user, '/api/v1/observations', pending.current);
    pending.current = null;
    return '課題を確認しました。学生の画面と面談画面で今の締切を見られます。';
  });
  return <>
    <p>先生役で締切を延ばしたあと、「LMSを開く」を押すと学生の画面と面談画面の締切が変わります。</p>
    <div className="demo-actions"><button disabled={busy} onClick={() => { void open(); }}>LMSを開く</button>
      <a href="/student" target="_blank" rel="noreferrer">学生の画面を開く</a></div>
    <section aria-label="先生役の操作"><h2>先生役で締切を変える</h2>
      {data.courses.flatMap(course => course.assignments).filter(task => task.submission !== 'submitted').map(task =>
        <div className="demo-teacher-action" key={task.sourceId}><p>{task.title}：{demoDueText(task.dueAt)}</p>
          <button disabled={busy || pending.current !== null} onClick={() => { void action(async () => {
            await post(user, '/api/v1/demo/extend', { sourceId: task.sourceId, expectedDueAt: task.dueAt });
            return 'LMSの締切を1日延ばしました。「LMSを開く」で課題を確かめてください。';
          }); }}>「{task.title}」の締切を1日延ばす</button></div>)}
    </section>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <div ref={pages}><DemoPages data={data} /></div>
  </>;
}
