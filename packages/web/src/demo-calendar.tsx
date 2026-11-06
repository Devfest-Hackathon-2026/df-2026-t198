import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import type { CalendarIntegration, CalendarItem, DeadlineEvent } from '@kadai-hisho/core';
import { firebase } from './firebase';

function eventTime(event: DeadlineEvent) {
  return 'date' in event.start ? `${event.start.date}（日付のみ）` : new Intl.DateTimeFormat('ja-JP', {
    timeZone: event.start.timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(event.start.dateTime));
}
export function DemoCalendarView({ integration, pending }: { integration: CalendarIntegration; pending: boolean }) {
  const events = Object.entries(integration.mockEvents ?? {}).sort(([, a], [, b]) => {
    const start = (event: DeadlineEvent) => 'date' in event.start ? event.start.date : event.start.dateTime;
    return start(a.event).localeCompare(start(b.event));
  });
  return <section className="upcoming" aria-labelledby="demo-calendar-title"><h2 id="demo-calendar-title">体験用カレンダー</h2>
    <p>架空の予定です。Googleカレンダーには入りません。</p>
    {pending && <p role="status">予定の更新を待っています。「LMSを開く」で再試行できます。</p>}
    <ul>{events.map(([id, { event }]) => <li key={id}><strong>{eventTime(event)}</strong> {event.summary}</li>)}</ul>
  </section>;
}
export function DemoCalendar() {
  const [value, setValue] = useState<{ integration: CalendarIntegration; pending: boolean } | null>(null);
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
      const publish = () => {
        if (!active) return;
        setValue(integration?.mode === 'mock' && integration.executor === 'demo' && items ? {
          integration, pending: items.some(item => item.appliedRevision !== item.desiredRevision),
        } : null);
      };
      const fail = () => { if (active) { active = false; setValue(null); setFailed(true); } };
      const options = { includeMetadataChanges: true };
      const stops = [
        onSnapshot(doc(firebase!.db, 'students', user.uid, 'integrations', 'calendar'), options, snapshot => {
          if (!active) return;
          if (snapshot.metadata.fromCache) { setValue(null); return; }
          integration = snapshot.data() as CalendarIntegration | undefined; publish();
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
  if (failed) return <p role="alert">カレンダーを開けませんでした。接続を確かめてください。</p>;
  return value ? <DemoCalendarView {...value} /> : null;
}
