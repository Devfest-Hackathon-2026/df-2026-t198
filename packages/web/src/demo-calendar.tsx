import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import type { CalendarIntegration, CalendarItem, DeadlineEvent, LedgerAssignment } from '@kadai-hisho/core';
import { firebase } from './firebase';
import { useDeadlineChanges } from './deadline-change';
import { dayInZone } from './session-model';
import type { ReactNode } from 'react';

function eventDay(event: DeadlineEvent) {
  return 'date' in event.start ? event.start.date : dayInZone(new Date(event.start.dateTime), 'Asia/Tokyo');
}
function eventTime(event: DeadlineEvent) {
  return 'date' in event.start ? '日付のみ' : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(event.start.dateTime));
}
export function DemoCalendarView({ integration, pending, now = Date.now(), submitted = new Set<string>() }: {
  integration: CalendarIntegration; pending: boolean; now?: number; submitted?: ReadonlySet<string>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const today = dayInZone(new Date(now), 'Asia/Tokyo');
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  const events = Object.entries(integration.mockEvents ?? {}).sort(([, a], [, b]) => {
    const start = (event: DeadlineEvent) => 'date' in event.start ? event.start.date : event.start.dateTime;
    return start(a.event).localeCompare(start(b.event));
  });
  const changed = useDeadlineChanges(new Map(events.map(([id, { event }]) => [id, `${eventDay(event)} ${eventTime(event)}`])));
  const outside = events.filter(([, { event }]) => !days.includes(eventDay(event)));
  const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
  const showDay = (day: string) => {
    const container = scroll.current;
    const cell = container?.querySelector<HTMLElement>(`[data-date="${day}"]`);
    if (container && cell) container.scrollLeft = day === today ? 0 :
      container.scrollLeft + cell.getBoundingClientRect().left - container.getBoundingClientRect().left - container.clientLeft;
  };
  return <section className="deadline-calendar" aria-labelledby="demo-calendar-title"><h2 id="demo-calendar-title">締切のカレンダー</h2>
    {pending && <p role="status">予定の更新を待っています。「LMSを開く」で再試行できます。</p>}
    <p className="scroll-hint">カレンダーは左右に動かせます。日付のボタンで、その日の締切を表示できます。</p>
    <div className="calendar-navigation"><button onClick={() => showDay(today)}>今日へ</button>
      {[...new Set(events.map(([, { event }]) => eventDay(event)))].filter(day => day !== today && days.includes(day)).map(day =>
        <button key={day} onClick={() => showDay(day)}>{dateLabel(day)}の締切へ</button>)}</div>
    <div ref={scroll} className="calendar-scroll" tabIndex={0} role="region" aria-label="今日から7日の締切">
      <table className="deadline-week"><thead><tr>{days.map((day, i) => <th scope="col" key={day} className={i === 0 ? 'calendar-today' : undefined}>
        <time dateTime={day}>{dateLabel(day)}（{'日月火水木金土'[new Date(`${day}T00:00:00Z`).getUTCDay()]}）</time>
      </th>)}</tr></thead><tbody><tr>{days.map((day, i) => <td key={day} data-date={day} className={i === 0 ? 'calendar-today' : undefined}>
        <ul>{events.filter(([, { event }]) => eventDay(event) === day).map(([id, { event, itemKey }]) => {
          const separator = event.summary.indexOf('：');
          const course = separator < 0 ? null : event.summary.slice(0, separator);
          const title = separator < 0 ? event.summary : event.summary.slice(separator + 1);
          return <li key={id} className={`calendar-event${changed.has(id) ? ' changed' : ''}${submitted.has(itemKey) ? ' submitted' : ''}`}>
            <time>{eventTime(event)}</time> <strong>{title}</strong>{course && <span className="muted">{course}</span>}
            {submitted.has(itemKey) && <span className="badge done">出せました</span>}
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
    <p>{!integration ? '準備の予定は保存されています。拡張機能でカレンダーを接続すると、予定が入ります。'
      : integration.connectionState === 'reauthorization-required' ? 'カレンダーをもう一度接続してください。準備の予定は保存されています。'
        : integration.connectionState === 'recovery-required' ? 'カレンダーの接続を確かめてください。準備の予定は保存されています。'
          : pending ? '予定は保存されています。カレンダーへの変更を待っています。PCのChromeで拡張機能を起動すると、更新を試みます。'
            : 'カレンダーへの変更が済んでいます。'}</p>
  </section>;
}
export function DemoCalendar({ fallback, now, assignments = [] }: { fallback?: ReactNode; now?: number; assignments?: LedgerAssignment[] }) {
  const [value, setValue] = useState<{ integration: CalendarIntegration | null; pending: boolean; items: CalendarItem[] } | null>(null);
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
        setValue(integrationReceived && items && (integration || items.some(item => item.kind === 'preparation')) ? {
          integration: integration ?? null, pending: items.some(item => item.appliedRevision !== item.desiredRevision), items,
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
    ? <DemoCalendarView integration={value.integration} pending={value.pending} now={now ?? Date.now()}
      submitted={new Set(value.items.filter(item => item.kind === 'deadline' && assignments.some(row =>
        row.submission === 'submitted' &&
        row.key.system === item.sourceKey.system && row.key.sourceId === item.sourceKey.sourceId)).map(item => item.itemKey))} />
      : <>{fallback}<GoogleCalendarStatus {...value} /></> : fallback;
}
