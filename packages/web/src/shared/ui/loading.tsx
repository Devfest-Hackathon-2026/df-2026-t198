import { useEffect, useState, useSyncExternalStore } from 'react';
import { pendingRequests, subscribeRequests } from '../network';

export function Skeleton({ lines = 3, label = '読み込み中' }: { lines?: number; label?: string }) {
  return <div className="td-skeleton" role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: Math.max(1, Math.min(12, lines)) }, (_, index) => <span key={index} aria-hidden="true" />)}</div>;
}
export function NetworkProgress() {
  const pending = useSyncExternalStore(subscribeRequests, pendingRequests, () => 0);
  return pending > 0 ? <div className="td-network" role="status" aria-label="通信中"><span aria-hidden="true" /></div> : null;
}
/** Text remains truthful for any API call. A caller may supply operation-specific wording. */
export function LongWait({ busy, afterThree = 'サーバーの応答を待っています…', afterTen = 'まだ応答を待っています。操作が終わるまで、この画面でお待ちください。' }: {
  busy: boolean; afterThree?: string; afterTen?: string;
}) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    setStage(0); if (!busy) return;
    const first = window.setTimeout(() => setStage(1), 3000);
    const second = window.setTimeout(() => setStage(2), 10000);
    return () => { window.clearTimeout(first); window.clearTimeout(second); };
  }, [busy]);
  return busy && stage > 0 ? <p className="td-long-wait" role="status">{stage === 1 ? afterThree : afterTen}</p> : null;
}
