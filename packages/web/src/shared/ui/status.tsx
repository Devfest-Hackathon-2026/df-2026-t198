import type { ReactNode } from 'react';
import { Button } from './button';

export type Status = 'todo' | 'doing' | 'done' | 'overdue' | 'changed';
const statusLabels: Record<Status, string> = {
  todo: 'まだ', doing: '取り組み中', done: '出せました', overdue: '締切を過ぎています', changed: '締切が変わった',
};
const symbols = { todo: '○', doing: '◐', done: '✓', overdue: '!', changed: '→', idle: '−', loading: '◌', empty: '✓', error: '!' };
export function StatusChip({ status = 'todo', children }: { status?: Status; children?: ReactNode }) {
  return <span className={`td-chip td-chip-${status}`}><span aria-hidden="true">{symbols[status]}</span>{children ?? statusLabels[status]}</span>;
}
export interface FetchStateProps {
  state?: 'idle' | 'loading' | 'empty' | 'error'; title?: string; detail?: ReactNode;
  lastFetched?: string; onRetry?: () => void; busy?: boolean | undefined;
}
const fetchLabels = {
  idle: 'まだつながっていません', loading: '課題を確認しています…', empty: '課題はありません', error: '課題を確認できませんでした',
};
export function FetchState({ state = 'idle', title, detail, lastFetched, onRetry, busy }: FetchStateProps) {
  return <div className={`td-fetch td-fetch-${state}`} role={state === 'error' ? 'alert' : 'status'} aria-busy={state === 'loading' || busy}>
    <span aria-hidden="true">{symbols[state]}</span><div><b>{title ?? fetchLabels[state]}</b>{detail}
      {lastFetched && <div className="td-num">{lastFetched} 時点</div>}</div>
    {state === 'error' && onRetry && <div className="td-fetch-action"><Button onClick={onRetry} busy={busy} busyLabel="確認中…">もう一度試す</Button></div>}
  </div>;
}
export function Notice({ tone = 'info', title, children, action }: {
  tone?: 'info' | 'changed' | 'error'; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return <div className={`td-notice td-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <div><span className={`td-notice-title${tone === 'changed' ? ' td-marker' : ''}`}>{title}</span>{children && <div>{children}</div>}</div>{action}
  </div>;
}
