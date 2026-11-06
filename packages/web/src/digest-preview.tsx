import { useEffect, useState, type MouseEvent } from 'react';
import type { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { firebase } from './firebase';
import { actionMessage, performPlanAction, planActionErrorMessage } from './plan-progress';
import './digest-preview.css';
interface Preview { subject: string; html: string; empty: boolean }
export function DigestPreview({ user }: { user: User }) {
  const [digest, setDigest] = useState<Preview | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const response = await fetch('/api/v1/digest', { cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
        if (!response.ok) throw new Error();
        const value = await response.json() as Preview;
        if (active && current === request) setDigest(value);
      } catch { if (active && current === request) { setDigest(null); setMessage('メールの見本を開けませんでした。接続を確かめてください。'); } }
    };
    const stop = ['plans', 'assignments'].map(name => onSnapshot(collection(firebase!.db, 'students', user.uid, name),
      () => { void load(); }, () => { request++; setDigest(null); setMessage('メールの見本を開けませんでした。'); }));
    return () => { active = false; stop.forEach(cancel => cancel()); };
  }, [user, version]);
  async function prepare() {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/v1/digest/demo-plan', { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error();
      setVersion(value => value + 1);
    } catch { setMessage('先に「LMSを開く」で課題を読み込んでから、もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  async function click(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest('a'); if (!anchor) return;
    const url = new URL(anchor.href);
    if (url.pathname !== '/student/plan') return;
    event.preventDefault(); if (busy) return;
    const id = url.searchParams.get('id'); const action = url.searchParams.get('do');
    const rev = url.searchParams.get('rev') ?? '';
    if (!id || (action !== 'done' && action !== 'later') || !/^[1-9]\d*$/.test(rev) || !Number.isSafeInteger(Number(rev))) return;
    setBusy(true); setMessage('');
    try { const result = await performPlanAction(user, id, action, Number(rev)); setMessage(actionMessage(result.outcome)); }
    catch (error) { setMessage(planActionErrorMessage(error, '予定の変更を確認できませんでした。もう一度お試しください。')); }
    finally { setBusy(false); }
  }
  return <section className="digest-preview" aria-label="今日やることのメール"><h2>今日やることのメール</h2>
    <p>今日の準備と締切の近い課題を知らせるメールの見本です。ここからメールは送りません。</p>
    <button disabled={busy} onClick={() => { void prepare(); }}>今日の準備の見本を用意する</button>
    {digest && !digest.empty && <><h3>{digest.subject}</h3>
      <div aria-busy={busy} onClick={event => { void click(event); }} dangerouslySetInnerHTML={{ __html: digest.html }} /></>}
    {digest?.empty && <p>今日の準備や近い締切がない日は、メールを送りません。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
