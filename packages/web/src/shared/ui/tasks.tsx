import { Fragment, useId, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './button';
import { StatusChip, type Status } from './status';
import { ScrollFrame } from './scroll-frame';

export interface DeadlineTextProps { due?: string | null | undefined; now?: string | undefined }
export function DeadlineText({ due, now = new Date().toISOString() }: DeadlineTextProps) {
  if (!due || !Number.isFinite(Date.parse(due))) return <span className="td-deadline td-deadline-unknown">締切を読み取れませんでした</span>;
  // Date-only deadlines stay date-only: never invent a submission time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return <span className="td-deadline"><time dateTime={due}>{due.replaceAll('-', '/')}</time></span>;
  const remaining = Date.parse(due) - Date.parse(now);
  const tone = remaining < 0 ? 'overdue' : remaining <= 48 * 3600_000 ? 'soon' : 'normal';
  const label = remaining < 0 ? '締切を過ぎています' : remaining === 0 ? '締切の時刻です' : remaining < 3600_000 ? 'あと1時間未満' :
    remaining < 24 * 3600_000 ? `あと${Math.ceil(remaining / 3600_000)}時間` : `あと${Math.ceil(remaining / (24 * 3600_000))}日`;
  return <span className={`td-deadline td-deadline-${tone}`}><time dateTime={due}>{new Date(due).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })}</time><span className="td-deadline-left">{label}</span></span>;
}
export interface TaskRowProps extends DeadlineTextProps { course: string; title: string; status?: Status; changed?: boolean; href?: string; deadline?: ReactNode; onSelect?: (() => void) | undefined }
export function TaskRow({ course, title, due, now, status, changed, href, deadline, onSelect }: TaskRowProps) {
  const content = <><span className="td-taskrow-course">{course}</span><span className="td-taskrow-title">{title}</span>
    <span className="td-taskrow-side">{changed && <StatusChip status="changed" />}
      {status && (!changed || status !== 'changed') && <StatusChip status={status} />}
      {status !== 'done' && (deadline ?? <DeadlineText due={due} now={now} />)}</span></>;
  const className = `td-taskrow${status === 'done' ? ' td-taskrow-done' : ''}`;
  return href ? <a className={className} href={href}>{content}</a> : onSelect ? <button type="button" className={className} onClick={onSelect}>{content}</button> : <div className={className}>{content}</div>;
}
export interface NextActionProps extends DeadlineTextProps {
  course: string; title: string; step?: string; deadline?: ReactNode; actionLabel?: string; onStart?: () => void; busy?: boolean | undefined; busyLabel?: string | undefined;
}
export function NextAction({ course, title, step, due, now, actionLabel = 'LMSで開く', onStart, busy, busyLabel, deadline }: NextActionProps) {
  const id = useId();
  return <section className="td-next" aria-labelledby={id}><p className="td-next-eyebrow">次にやること · {course}</p>
    <h2 className="td-next-title" id={id}><span className="td-marker">{title}</span></h2>
    {step && <p className="td-next-step">{step}</p>}<div className="td-next-foot">{deadline ?? <DeadlineText due={due} now={now} />}
      <Button variant="primary" onClick={onStart} busy={busy} busyLabel={busyLabel} disabled={!onStart}>{actionLabel}</Button></div></section>;
}
export interface TaskTableRow { id: string; course: string; title: string; due?: string | null; status?: Status; remaining?: string; deadline?: ReactNode; note?: ReactNode }
export interface TaskTableProps { rows: TaskTableRow[]; now?: string; selected?: string; caption?: string; onSelect?: (id: string) => void }
export function TaskTable({ rows, now, selected, caption = '課題', onSelect }: TaskTableProps) {
  const [local, setLocal] = useState<string>();
  const hasStatus = rows.some(row => row.status);
  const hasRemaining = rows.some(row => row.remaining);
  return <ScrollFrame label={caption} className="td-table-wrap"><table className="td-table"><caption>{caption}</caption>
    <thead><tr>{['科目', '課題', '締切', ...(hasStatus ? ['状況'] : []), ...(hasRemaining ? ['残り'] : [])].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} data-selected={row.id === (selected ?? local)}>
      <td>{row.course}</td><td>{onSelect ? <button type="button" className="td-table-select" aria-pressed={row.id === (selected ?? local)}
        onClick={() => { setLocal(row.id); onSelect(row.id); }}>{row.title}</button> : row.title}{row.note}</td>
      <td>{row.deadline ?? (row.status !== 'done' && <DeadlineText due={row.due} now={now} />)}</td>{hasStatus && <td>{row.status && <StatusChip status={row.status} />}</td>}{hasRemaining && <td className="td-r">{row.remaining}</td>}
    </tr>)}</tbody></table></ScrollFrame>;
}
export interface DetailPanelProps { title: string; facts?: [string, ReactNode][]; agreed?: string; actions?: ReactNode }
export function DetailPanel({ title, facts = [], agreed, actions }: DetailPanelProps) {
  const id = useId();
  return <aside className="td-detail" aria-labelledby={id}><h3 id={id}>{title}</h3><dl>{facts.map(([label, value]) =>
    <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>{agreed && <div className="td-detail-note"><span>面談で決めた次の一歩</span><p>{agreed}</p></div>}{actions && <div className="td-next-foot">{actions}</div>}</aside>;
}
export type { ButtonProps };
