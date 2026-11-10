import { useEffect, useId, useState } from 'react';
import type { SessionServices } from './firebase';
import { watchSession, type SessionState } from './watch';
import { SessionLink } from './route';
import { studentSummary } from './student-summary';
import { formatDeadline, formatMoment } from '../../shared/assignments/deadline-format';

export function StudentList({ students, viewer, source }: {
  students: Awaited<ReturnType<SessionServices['students']>>;
  viewer: string; source: SessionServices['source'];
}) {
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [now, setNow] = useState(() => new Date());
  const [order, setOrder] = useState('deadline');
  const descriptionId = useId();
  useEffect(() => {
    let active = true;
    setStates({});
    const stops = students.map(student => watchSession(source, student.uid, viewer, state => {
      if (!active) return;
      setStates(previous => ({ ...previous, [student.uid]: state }));
      setNow(new Date());
    }));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [students, source, viewer]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const rows = students.flatMap(student => {
    const state = states[student.uid];
    return state?.status === 'ready' ? [{ student, summary: studentSummary(state.data, now) }] : [];
  }).sort((a, b) => (order === 'changes' ? (b.summary.changes ?? -1) - (a.summary.changes ?? -1) : 0)
    || a.summary.deadlineOrder - b.summary.deadlineOrder || a.student.uid.localeCompare(b.student.uid));
  const pending = students.some(student => !states[student.uid] || states[student.uid]?.status === 'loading');
  const failed = students.some(student => states[student.uid]?.status === 'error');
  return <>
    <label className="session-student-sort">並べ方
      <select value={order} onChange={event => setOrder(event.target.value)}>
        <option value="deadline">締切が近い順</option><option value="changes">変化が多い順</option>
      </select>
    </label>
    <p className="session-list-note">今週は月曜から日曜までの、これからの締切を数えています。</p>
    {pending && <p role="status">学生の共有と課題を確認しています…</p>}
    {failed && <p role="alert">確認できなくなった学生の表示を消しました。接続を確かめて、画面を開き直してください。</p>}
    {!pending && !failed && !rows.length && <p role="status">表示できる共有中の学生はいません。</p>}
    <nav aria-label="担当する学生">{rows.map(({ student, summary }) =>
      <SessionLink key={student.uid} href={`/session/${encodeURIComponent(student.uid)}`}
        aria-label={student.displayName ?? `学生 ${student.uid}`} aria-describedby={`${descriptionId}-${student.uid}`}>
        <span className="rd-avatar" aria-hidden="true">{(student.displayName ?? '学生').slice(0, 1)}</span>
        <span className="rd-student-description"><strong>{student.displayName ?? '学生'}</strong>
          {!student.displayName && <span className="session-student-id">{student.uid}</span>}
          <span className="rd-student-facts" id={`${descriptionId}-${student.uid}`}>
            <span>いちばん近い締切：{summary.nearest ? formatDeadline(summary.nearest) : '確認できた今後の締切なし'}</span>
            <span>今週の締切 {summary.thisWeek}件</span>
            <span>{summary.changes === null ? '前回の面談日時未設定' : `前回の面談からの変化 ${summary.changes}件`}</span>
            <span>準備の予定：{summary.hasPreparation ? 'あり' : 'なし'}</span>
            <span>最後に取得できた時刻：{summary.lastSucceededAt ? formatMoment(summary.lastSucceededAt) : '取得記録なし'}</span>
            {summary.incomplete && <span className="notice">古い情報、または確認できていない課題があります。</span>}
          </span>
        </span><span className="rd-open" aria-hidden="true">開く</span>
      </SessionLink>)}</nav>
  </>;
}
