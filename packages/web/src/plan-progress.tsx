import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { PreparationPlan } from '../../core/src/types';

export function planProgress(plan: PreparationPlan) {
  return plan.status === 'done' ? '終わった（LMSへの提出は別）' : plan.laterResult === 'moved' ? '後回しにした' : 'まだ';
}
export const actionMessage = (outcome: string) => outcome === 'done' ? '準備を「終わった」にしました。LMSへの提出は別に行ってください。' :
  outcome === 'moved' ? '次の空いたコマに動かしました。カレンダーの更新は接続中の拡張機能で行います。' : '締切より前の空いたコマを確かめられなかったため、予定を動かしませんでした。';
export async function performPlanAction(user: User, id: string, action: 'done' | 'later', revision: number) {
  const response = await fetch(`/api/v1/plans/${encodeURIComponent(id)}/${action}?rev=${revision}`, { method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  if (!response.ok) throw new Error('plan-action-failed');
  return await response.json() as { outcome: 'done' | 'moved' | 'no-slot'; plan: PreparationPlan };
}
export function PlanLinkAction({ user }: { user: User }) {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('id'); const action = query.get('do');
  const rev = query.get('rev') ?? '';
  const [message, setMessage] = useState('準備の予定を確かめています…');
  const [retry, setRetry] = useState(0); const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!id || !/^[a-f0-9-]{36}$/.test(id) || (action !== 'done' && action !== 'later') ||
      !/^[1-9]\d*$/.test(rev) || !Number.isSafeInteger(Number(rev))) { setMessage('準備の予定のリンクを確かめてください。'); return; }
    let active = true; setFailed(false);
    void performPlanAction(user, id, action, Number(rev)).then(result => { if (active) setMessage(actionMessage(result.outcome)); })
      .catch(() => { if (active) { setMessage('この予定を変更できませんでした。本人のアカウントか、接続と予定の状態を確かめてください。'); setFailed(true); } });
    return () => { active = false; };
  }, [user, id, action, rev, retry]);
  return <section className="notice" aria-label="準備の予定の操作"><p role="status">{message}</p>
    {failed && <button onClick={() => setRetry(retry + 1)}>もう一度試す</button>}<a href="/student">時間割を見る</a></section>;
}
