import { Button, Field } from '../../shared/ui';
import type { ManualAssignmentActions } from './api';
import { useRef, useState, type FormEvent } from 'react';
import { manualDeadline } from '@kadai-hisho/core';
import type { ManualAssignment, ManualAssignmentInput } from '../../../../core/src/types';
import type { StudentCourse } from '../../shared/assignments/types';
import { formatDeadline } from '../../shared/assignments/deadline-format';
import { manualAssignmentEnded } from '../../shared/assignments/deadline-entries';
import './manual-assignments.css';
import { courseColor } from '../../shared/course-color';

export const manualAuthor = (row: ManualAssignment) => `手で入れた課題（${row.createdByRole === 'supporter' ? '支援担当' : '学生'}が入れました）`;

export function ManualAssignmentForm({ courses, actions, course }: {
  courses: StudentCourse[]; actions: ManualAssignmentActions; course?: StudentCourse | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ signature: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const selected = courses.find(c => JSON.stringify([c.system, c.courseId]) === form.get('course'));
    const input: ManualAssignmentInput = { title: String(form.get('title')).trim(), date: String(form.get('date')),
      time: form.get('time') ? String(form.get('time')) : null, memo: String(form.get('memo') ?? '').trim(),
      course: selected ? { system: selected.system, courseId: selected.courseId } : null };
    if (!input.title) { setMessage('課題の名前を入力してください。'); return; }
    const signature = JSON.stringify(input);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setMessage('');
    try {
      await actions.add(pending.current.id, input);
      element.reset(); pending.current = null; setMessage('課題を入れました。');
    } catch (error) {
      if (error instanceof Error && error.message === 'conflict') pending.current = null;
      if (error instanceof Error && error.message === 'invalid-input') {
        setMessage('入力内容を確かめて、入れ直してください。');
        return;
      }
      setMessage(error instanceof Error && error.message === 'conflict'
        ? 'この課題は入れられませんでした。授業を選び直すか、もう一度お試しください。'
        : '保存を確認できませんでした。接続と共有の許可を確かめて、同じ内容でもう一度お試しください。');
    } finally { setBusy(false); }
  }
  return <form className="manual-assignment-form" onSubmit={event => { void submit(event); }}>
    <Field label="課題の名前" name="title" required maxLength={160} />
    <Field label="締切の日付" name="date" type="date" required />
    <Field label="締切の時刻（任意）" name="time" type="time" />
    <label>授業（任意）<select aria-label="授業（任意）" name="course" defaultValue={course ? JSON.stringify([course.system, course.courseId]) : ''}>
      <option value="">授業を選ばない</option>{courses.map(c => <option key={JSON.stringify([c.system, c.courseId])}
        value={JSON.stringify([c.system, c.courseId])}>{c.name}</option>)}
    </select></label>
    <Field label="メモ（任意・300文字まで）" name="memo" maxLength={300} />
    <Button type="submit" busy={busy} busyLabel="保存中…">課題を入れる</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}
export function ManualAssignmentRow({ row, actions, own, viewerUid }: {
  row: ManualAssignment; actions?: ManualAssignmentActions | undefined; own: boolean; viewerUid?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (!actions || busy) return;
    setBusy(true); setError('');
    try { await actions.remove(row.manualAssignmentId); }
    catch { setError('削除を確認できませんでした。接続と共有の許可を確かめて、もう一度お試しください。'); }
    finally { setBusy(false); }
  }
  return <li className="manual-assignment" data-course-color={courseColor(row.course)} data-manual-id={row.manualAssignmentId}>
    <h3>{row.title}</h3><p><time>{formatDeadline(manualDeadline(row))}</time>{row.courseName && <span className="muted course-label"> {row.courseName}</span>}</p>
    <p className="manual-author">{manualAuthor(row)}</p>{row.memo && <p className="manual-memo">{row.memo}</p>}
    {actions && (own || row.createdBy === viewerUid) && <Button busy={busy} busyLabel="消しています…" aria-label={`${row.title}を消す`}
      onClick={() => { void remove(); }}>消す</Button>}
    {error && <p role="alert">{error}</p>}
  </li>;
}
export function ManualAssignments({ rows, courses, actions, own, viewerUid, now = Date.now() }: {
  rows: ManualAssignment[]; courses: StudentCourse[]; actions?: ManualAssignmentActions | undefined; own: boolean; viewerUid?: string | undefined;
  now?: number | undefined;
}) {
  const active = rows.filter(row => row.status === 'active' && !manualAssignmentEnded(row, now));
  const finished = rows.filter(row => row.status === 'active' && manualAssignmentEnded(row, now));
  return <section className="manual-assignments" aria-label="手で入れた課題">
    {!!active.length && <><h2>手で入れた課題</h2><ul>{active.map(row => <ManualAssignmentRow key={row.manualAssignmentId}
      row={row} actions={actions} own={own} viewerUid={viewerUid} />)}</ul></>}
    {!!finished.length && <details className="finished-assignments"><summary>終了した課題</summary>
      <ul>{finished.map(row => <ManualAssignmentRow key={row.manualAssignmentId}
        row={row} actions={actions} own={own} viewerUid={viewerUid} />)}</ul></details>}
    {actions && <details><summary>課題を手で入れる</summary><ManualAssignmentForm courses={courses} actions={actions} /></details>}
  </section>;
}
