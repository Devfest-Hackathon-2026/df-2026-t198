import { Button } from '../../shared/ui/button';
import { serverFetch } from '../../shared/network';
import { useEffect, useState, type MouseEvent } from 'react';
import type { User } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { firebase } from '../../shared/firebase';
import type { PreparationPlan } from '../../../../core/src/types';
import { PlanLinkAction, planProgress } from '../plans/progress';
import './digest-preview.css';
import type { StudentData } from '../../shared/assignments/types';
import { useOperationMessage } from '../../shared/ui/operation-messages';
interface Preview { subject: string; html: string; empty: boolean }
export function DigestPreview({ user }: { user: User }) {
  const [digest, setDigest] = useState<Preview | null>(null);
  const [message, setMessage] = useOperationMessage(); const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [actionLink, setActionLink] = useState<string>();
  const [data, setData] = useState<Pick<StudentData, 'plans' | 'assignments' | 'courses'>>({ plans: [], assignments: [], courses: [] });
  useEffect(() => {
    let active = true; let request = 0;
    const stops: (() => void)[] = [];
    const stop = () => { active = false; request++; stops.splice(0).forEach(cancel => cancel()); };
    const load = async () => {
      const current = ++request;
      try {
        const response = await serverFetch('/api/v1/digest/demo-preview', { cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
        if (!response.ok) throw new Error();
        const value = await response.json() as Preview;
        if (active && current === request) setDigest(value);
      } catch { if (active && current === request) { setDigest(null); setMessage('メールの見本を開けませんでした。接続を確かめてください。'); } }
    };
    const fail = () => {
      if (!active) return;
      stop(); setActionLink(undefined); setDigest(null); setData({ plans: [], assignments: [], courses: [] });
      setMessage('メールの見本を開けませんでした。');
    };
    for (const name of ['plans', 'assignments', 'courses'] as const) {
      const unsubscribe = onSnapshot(collection(firebase!.db, 'students', user.uid, name),
        snapshot => {
          if (!active) return;
          setData(current => ({ ...current, [name]: snapshot.docs.map(doc => doc.data()) })); void load();
        }, fail);
      if (!active) { unsubscribe(); break; }
      stops.push(unsubscribe);
    }
    return stop;
  }, [user, version]);
  async function prepare() {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const response = await serverFetch('/api/v1/digest/demo-plan', { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) {
        const value = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(value.error === 'plan-after-deadline' ? value.error : 'demo-plan-failed');
      }
      const plan = await response.json() as PreparationPlan;
      setMessage(`見本の準備：${plan.date.replaceAll('-', '/')} ${plan.startsAt.slice(11, 16)}〜${plan.endsAt.slice(11, 16)}、${planProgress(plan) || 'まだ'}。最初から試すときは「体験を最初からやり直す」を押してください。`);
      setVersion(value => value + 1);
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'plan-after-deadline'
        ? '今日の空いたコマは課題の締切より後になるため、見本を用意できませんでした。締切を確かめてください。'
        : '先に「LMSを開く」で課題を読み込んでから、もう一度お試しください。');
    }
    finally { setBusy(false); }
  }
  function click(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest('a'); if (!anchor) return;
    const url = new URL(anchor.href);
    if (url.pathname !== '/student/plan') return;
    event.preventDefault(); if (busy) return;
    setActionLink(url.href);
  }

  return <section className="digest-preview" aria-label="今日やることのメール"><h2>今日やることのメール</h2>
    <p>今日の準備と次に提出する課題、締切の近い課題を知らせるメールの見本です。ここからメールは送りません。</p>
    <Button busy={busy} busyLabel="準備中…" onClick={() => { void prepare(); }}>今日の準備の見本を用意する</Button>
    {digest && !digest.empty && <><h3>{digest.subject}</h3>
      <div aria-busy={busy} onClick={click} dangerouslySetInnerHTML={{ __html: digest.html }} /></>}
    {actionLink && <PlanLinkAction user={user} data={data} link={actionLink} />}
    {digest?.empty && <p>今日の準備や次に提出する課題、近い締切がない日は、メールを送りません。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
