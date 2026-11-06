import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import type { CalendarIntegration, CalendarItem, DeadlineEvent } from '@kadai-hisho/core';
import { firebase } from './firebase';
import { useDeadlineChanges } from './deadline-change';
import { dayInZone } from './session-model';
import type { ReactNode } from 'react';
import type { StudentCourse } from './student-data';

function eventDay(event: DeadlineEvent) {
  return 'date' in event.start ? event.start.date : dayInZone(new Date(event.start.dateTime), 'Asia/Tokyo');
}
function eventTime(event: DeadlineEvent) {
  return 'date' in event.start ? '日付のみ' : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(event.start.dateTime));
}
export function DemoCalendarView({ integration, pending, now = Date.now(), courses = [] }: {
  integration: CalendarIntegration; pending: boolean; now?: number; courses?: Pick<StudentCourse, 'name'>[];
}) {
  const today = dayInZone(new Date(now), 'Asia/Tokyo');
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  const events = Object.entries(integration.mockEvents ?? {}).sort(([, a], [, b]) => {
    const start = (event: DeadlineEvent) => Date.parse('date' in event.start
      ? `${event.start.date}T00:00:00+09:00` : event.start.dateTime);
    return start(a.event) - start(b.event);
  });
  const changed = useDeadlineChanges(new Map(events.map(([id, { event }]) => [id, `${eventDay(event)} ${eventTime(event)}`])));
  const outside = events.filter(([, { event }]) => !days.includes(eventDay(event)));
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
  return <section className="deadline-calendar" aria-labelledby="demo-calendar-title"><h2 id="demo-calendar-title">締切のカレンダー</h2>
    {pending && <p role="status">予定の更新を待っています。「LMSを開く」で再試行できます。</p>}
    <div className="calendar-scroll" tabIndex={0} role="region" aria-label="今日から7日の締切">
      <table className="deadline-week"><thead><tr>{days.map((day, i) => <th scope="col" key={day} className={i === 0 ? 'calendar-today' : undefined}>
        <time dateTime={day}>{dateLabel(day)}（{'日月火水木金土'[new Date(`${day}T00:00:00Z`).getUTCDay()]}）</time>
      </th>)}</tr></thead><tbody><tr>{days.map((day, i) => <td key={day} data-date={day} className={i === 0 ? 'calendar-today' : undefined}>
        <ul>{events.filter(([, { event }]) => eventDay(event) === day).map(([id, { event }]) => {
          const separator = event.summary.indexOf('：');
          const prefix = separator < 0 ? null : event.summary.slice(0, separator);
          const course = prefix === '準備' || courses.some(c => c.name === prefix || `【要確認】${c.name}` === prefix) ? prefix : null;
          const title = course ? event.summary.slice(separator + 1) : event.summary;
          return <li key={id} className={`calendar-event${changed.has(id) ? ' changed' : ''}`}>
            <time>{eventTime(event)}</time> <strong>{title}</strong>{course && <span className="muted">{course}</span>}
          </li>;
        })}</ul>
      </td>)}</tr></tbody></table>
    </div>
    {!!outside.length && <details className="calendar-outside"><summary>{outside.map(([, { event }]) => `${dateLabel(eventDay(event))}：${event.summary}`).join('、')}</summary>{outside.map(([id, { event }]) =>
      <p key={id}>{dateLabel(eventDay(event))}：{eventTime(event)} {event.summary}</p>)}</details>}
    <p className="muted">体験用の予定です。Googleカレンダーには入りません。</p>
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
export function DemoCalendar({ fallback, now, courses }: { fallback?: ReactNode; now?: number; courses: StudentCourse[] }) {
  const [value, setValue] = useState<{ integration: CalendarIntegration | null; pending: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!firebase) return;
    let stopData = () => {};
    const stopAuth = onAuthStateChanged(firebase.auth, user => {
      stopData(); setValue(null); setFailed(false);
      if (!user) return;
      let active = true;
      let integration: CalendarIntegration | undefined;
      let items: CalendarItem[] | undefined;
      let integrationReceived = false;
      const publish = () => {
        if (!active) return;
        setValue(integrationReceived && items && (integration || items.some(item => item.kind === 'preparation' || item.kind === 'manual-deadline')) ? {
          integration: integration ?? null, pending: items.some(item => item.appliedRevision !== item.desiredRevision),
        } : null);
      };
      const fail = () => { if (active) { active = false; setValue(null); setFailed(true); } };
      const options = { includeMetadataChanges: true };
      const stops = [
        onSnapshot(doc(firebase!.db, 'students', user.uid, 'integrations', 'calendar'), options, snapshot => {
          if (!active) return;
          if (snapshot.metadata.fromCache) { setValue(null); return; }
          integration = snapshot.data() as CalendarIntegration | undefined; integrationReceived = true; publish();
        }, fail),
        onSnapshot(collection(firebase!.db, 'students', user.uid, 'calendarItems'), options, snapshot => {
          if (!active) return;
          if (snapshot.metadata.fromCache) { setValue(null); return; }
          items = snapshot.docs.map(item => item.data() as CalendarItem); publish();
        }, fail),
      ];
      stopData = () => { active = false; stops.forEach(stop => stop()); };
    });
    return () => { stopAuth(); stopData(); };
  }, []);
  if (failed) return <>{fallback}<p role="alert">カレンダーを開けませんでした。接続を確かめてください。</p></>;
  return value ? value.integration?.mode === 'mock'
    ? <DemoCalendarView integration={value.integration} pending={value.pending} now={now ?? Date.now()} courses={courses} />
      : <>{fallback}<GoogleCalendarStatus {...value} /></> : fallback;
}
