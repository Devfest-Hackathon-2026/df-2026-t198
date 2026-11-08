import { ScrollFrame, useScrollEdges } from '../../shared/ui/scroll-frame';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';
import './calendar.css';
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import type { CalendarIntegration, CalendarItem, DeadlineEvent, LedgerAssignment, ManualAssignment } from '@kadai-hisho/core';
import { firebase } from '../../shared/firebase';
import { useDeadlineChanges } from '../../shared/assignments/deadline-change';
import { dayInZone } from '../../shared/assignments/deadline-format';
import type { ReactNode } from 'react';
import type { StudentCourse } from '../../shared/assignments/types';
import { useCourseColors } from '../../shared/course-color-context';
import { calendarCourses } from './course-colors';

function eventDay(event: DeadlineEvent) {
  return 'date' in event.start ? event.start.date : dayInZone(new Date(event.start.dateTime), 'Asia/Tokyo');
}
function dateLabelForEvent(event: DeadlineEvent) {
  const day = eventDay(event);
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
}
function eventTime(event: DeadlineEvent) {
  return 'date' in event.start ? '日付のみ' : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(event.start.dateTime));
}
export function DemoCalendarView({ integration, pending, now = Date.now(), submitted = new Set<string>(), courses = [], courseByItem = new Map() }: {
  integration: CalendarIntegration; pending: boolean; now?: number; submitted?: ReadonlySet<string>; courses?: Pick<StudentCourse, 'name'>[]; courseByItem?: ReadonlyMap<string, StudentCourse>;
}) {
  const courseColor = useCourseColors();
  const scroll = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scroll);
  const [selectedDay, setSelectedDay] = useState('');
  const today = dayInZone(new Date(now), 'Asia/Tokyo');
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  const events = Object.entries(integration.mockEvents ?? {}).sort(([, a], [, b]) => {
    const start = (event: DeadlineEvent) => Date.parse('date' in event.start
      ? `${event.start.date}T00:00:00+09:00` : event.start.dateTime);
    return start(a.event) - start(b.event);
  });
  const labels = useRef(new Map<string, { current: string; previous?: string }>());
  for (const [id, { event }] of events) {
    const current = `${dateLabelForEvent(event)} ${eventTime(event)}`;
    const last = labels.current.get(id);
    if (last?.current !== current) labels.current.set(id, { current, ...(last ? { previous: last.current } : {}) });
  }
  for (const id of labels.current.keys()) if (!events.some(([key]) => key === id)) labels.current.delete(id);
  const changed = useDeadlineChanges(new Map(events.map(([id, { event }]) => [id, `${eventDay(event)} ${eventTime(event)}`])));
  const outside = events.filter(([, { event }]) => !days.includes(eventDay(event)));
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
  const showDay = (day: string) => {
    setSelectedDay(day);
    const container = scroll.current;
    const cell = container?.querySelector<HTMLElement>(`[data-date="${day}"]`);
    if (container && cell) container.scrollLeft = day === today ? 0 :
      container.scrollLeft + cell.getBoundingClientRect().left - container.getBoundingClientRect().left - container.clientLeft;
  };
  return <section className="deadline-calendar" aria-labelledby="demo-calendar-title"><h2 id="demo-calendar-title">締切のカレンダー</h2>
    {pending && <p role="status">予定の更新を待っています。「LMSを開く」で再試行できます。</p>}
    {(edges.left || edges.right) && <div className="calendar-navigation"><button onClick={() => showDay(today)}>今日へ</button>
      {[...new Set(events.map(([, { event }]) => eventDay(event)))].filter(day => day !== today && days.includes(day)).map(day =>
        <button key={day} onClick={() => showDay(day)}>{dateLabel(day)}の締切へ</button>)}</div>}
    <ScrollFrame scrollRef={scroll} className="calendar-scroll" label="今日から7日間の締切">
      <table className="deadline-week"><thead><tr>{days.map((day, i) => <th scope="col" key={day} aria-current={day === selectedDay ? 'date' : undefined} className={i === 0 ? 'calendar-today' : undefined}>
        <time dateTime={day}>{dateLabel(day)}（{'日月火水木金土'[new Date(`${day}T00:00:00Z`).getUTCDay()]}）</time>
      </th>)}</tr></thead><tbody><tr>{days.map((day, i) => <td key={day} data-date={day} className={i === 0 ? 'calendar-today' : undefined}>
        <ul>{events.filter(([, { event }]) => eventDay(event) === day).map(([id, { event, itemKey }]) => {
          const separator = event.summary.indexOf('：');
          const prefix = separator < 0 ? null : event.summary.slice(0, separator);
          const course = prefix === '準備' || courses.some(c => c.name === prefix || `【要確認】${c.name}` === prefix) ? prefix : null;
          const title = course ? event.summary.slice(separator + 1) : event.summary;
          return <li key={id} data-course-color={courseColor(courseByItem.get(itemKey))} className={`calendar-event${changed.has(id) ? ' changed' : ''}${submitted.has(itemKey) ? ' submitted' : ''}`}>
            <time><ChangedDeadline value={labels.current.get(id)!.current} previous={labels.current.get(id)?.previous} highlight={changed.has(id)} /></time> <strong>{title}</strong>{course && <span className="muted">{course}</span>}
            {submitted.has(itemKey) && <span className="badge done">出せました</span>}
          </li>;
        })}</ul>
      </td>)}</tr></tbody></table>
    </ScrollFrame>
    {!!outside.length && <details className="calendar-outside"><summary>{outside.map(([, { event }]) => `${dateLabel(eventDay(event))}：${event.summary}`).join('、')}</summary>{outside.map(([id, { event, itemKey }]) =>
      <p key={id} data-course-color={courseColor(courseByItem.get(itemKey))}><span className="course-label">{dateLabel(eventDay(event))}：{eventTime(event)} {event.summary}</span></p>)}</details>}
    <p className="muted">体験用カレンダー</p>
  </section>;
}
export function GoogleCalendarStatus({ integration, pending }: { integration: CalendarIntegration | null; pending: boolean }) {
  return <section aria-label="Googleカレンダー"><h2>Googleカレンダー</h2>
    <p>{!integration ? '予定は保存されています。拡張機能でカレンダーを接続すると、予定が入ります。'
      : integration.connectionState === 'reauthorization-required' ? 'カレンダーをもう一度接続してください。予定は保存されています。'
        : integration.connectionState === 'recovery-required' ? 'カレンダーの接続を確かめてください。予定は保存されています。'
          : pending ? '予定は保存されています。カレンダーへの変更を待っています。PCのChromeで拡張機能を起動すると、更新を試みます。'
            : 'カレンダーへの変更が済んでいます。'}</p>
  </section>;
}
export function DemoCalendar({ fallback, now, assignments = [], courses, manual = [] }: { fallback?: ReactNode; now?: number; assignments?: LedgerAssignment[]; courses: StudentCourse[]; manual?: ManualAssignment[] }) {
  const [value, setValue] = useState<{ integration: CalendarIntegration | null; pending: boolean; items: CalendarItem[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!firebase) return;
    let mounted = true;
    let stopData = () => {};
    const stopAuth = onAuthStateChanged(firebase.auth, user => {
      if (!mounted) return;
      stopData(); setValue(null); setFailed(false);
      if (!user) return;
      let active = true;
      const stops: (() => void)[] = [];
      stopData = () => { active = false; stops.splice(0).forEach(stop => stop()); };
      let integration: CalendarIntegration | undefined;
      let items: CalendarItem[] | undefined;
      let integrationReceived = false;
      const publish = () => {
        if (!active) return;
        setValue(integrationReceived && items && (integration || items.some(item => item.kind === 'preparation' || item.kind === 'manual-deadline')) ? {
          integration: integration ?? null, pending: items.some(item => item.appliedRevision !== item.desiredRevision), items,
        } : null);
      };
      const fail = () => { if (active) { stopData(); setValue(null); setFailed(true); } };
      const options = { includeMetadataChanges: true };
      const watchIntegration = onSnapshot(doc(firebase!.db, 'students', user.uid, 'integrations', 'calendar'), options, snapshot => {
        if (!active) return;
        if (snapshot.metadata.fromCache) { setValue(null); return; }
        integration = snapshot.data() as CalendarIntegration | undefined; integrationReceived = true; publish();
      }, fail);
      if (!active) { watchIntegration(); return; }
      stops.push(watchIntegration);
      const watchItems = onSnapshot(collection(firebase!.db, 'students', user.uid, 'calendarItems'), options, snapshot => {
        if (!active) return;
        if (snapshot.metadata.fromCache) { setValue(null); return; }
        items = snapshot.docs.map(item => item.data() as CalendarItem); publish();
      }, fail);
      if (!active) watchItems(); else stops.push(watchItems);
    });
    return () => { mounted = false; stopAuth(); stopData(); };
  }, []);
  if (failed) return <>{fallback}<p role="alert">カレンダーを開けませんでした。接続を確かめてください。</p></>;
  return value ? value.integration?.mode === 'mock'
    ? <DemoCalendarView integration={value.integration} pending={value.pending} now={now ?? Date.now()} courses={courses}
      courseByItem={calendarCourses(value.items, assignments, courses, manual)}
      submitted={new Set(value.items.filter(item => item.kind === 'deadline' && assignments.some(row =>
        row.submission === 'submitted' &&
        row.key.system === item.sourceKey.system && row.key.sourceId === item.sourceKey.sourceId)).map(item => item.itemKey))} />
      : <>{fallback}<GoogleCalendarStatus {...value} /></> : fallback;
}
