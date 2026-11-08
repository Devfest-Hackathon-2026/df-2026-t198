import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { firebase } from '../../shared/firebase';
import { formatDeadline, formatMoment } from '../../shared/assignments/deadline-format';
import { deadlineEntries } from '../../shared/assignments/deadline-entries';
import { Skeleton } from '../../shared/ui/loading';
import { firebaseSessionSource } from '../session/firebase';
import { buildSessionView, emptySession } from '../session/model';
import { SessionAssignment } from '../session/page';
import { watchSession, type SessionState } from '../session/watch';
import { DemoTask } from './triptych';

export function useDemoObserved(user: User) {
  const [state, setState] = useState<SessionState>({ status: 'loading', data: emptySession() });
  useEffect(() => watchSession(firebaseSessionSource(firebase!.db), user.uid, user.uid, setState), [user.uid]);
  return state;
}

export function DemoObserved({ state, role }: { state: SessionState; role: 'student' | 'supporter' }) {
  if (state.status === 'loading') return <Skeleton label="課題を開いています…" />;
  if (state.status !== 'ready') return <p role="alert">課題を表示できませんでした。接続を確かめて、もう一度開いてください。</p>;
  const data = state.data;
  if (!data.assignments.length) return <p className="demo-empty-view">LMSを開く前</p>;
  if (role === 'supporter') {
    const rows = buildSessionView(data, new Date()).deadlines;
    return <><p className="demo-observed-label">次の面談までの締切</p>
      {data.context.nextSessionAt && <p className="demo-session-time">次回 {formatMoment(data.context.nextSessionAt)}</p>}
      <ul className="demo-session-tasks">{rows.map(row => <SessionAssignment key={row.key.sourceId} row={row} data={data} />)}</ul></>;
  }
  const rows = deadlineEntries(data.assignments, [], Date.now()).flatMap(entry => entry.kind === 'lms' ? [entry.row] : []);
  return <><p className="demo-observed-label">課題と締切</p>{rows.map(row => <DemoTask key={row.key.sourceId}
      identity={{ system: row.key.system, courseId: row.latest.courseId }}
      course={data.courses.find(course => course.system === row.key.system && course.courseId === row.latest.courseId)?.name ?? '授業'}
      title={row.latest.title} due={row.officialDeadline ? formatDeadline(row.officialDeadline.deadline) : '締切を確かめてください'} />)}</>;
}
