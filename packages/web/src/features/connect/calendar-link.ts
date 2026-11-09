import { collection, doc, onSnapshot, type Firestore } from 'firebase/firestore';
import type { CalendarIntegration, CalendarItem } from '../../../../core/src/types';

export type CalendarState = 'not-connected' | 'pending' | 'connected' | 'reconnect' | 'failed';
/** `demo` accounts keep their simulated calendar and never start a real Google connection. */
export interface CalendarLink { demo: boolean; state: CalendarState }

export function calendarState(integration: CalendarIntegration | null | undefined, items: CalendarItem[]): CalendarState {
  if (!integration || integration.mode !== 'google') return 'not-connected';
  // A new revision clears the last error, so an error here belongs to the event still waiting.
  const waiting = items.filter(item => item.calendarId && item.appliedRevision !== item.desiredRevision);
  if (integration.connectionState === 'reauthorization-required' ||
    waiting.some(item => item.lastErrorCode === 'authorization-required')) return 'reconnect';
  if (integration.connectionState === 'recovery-required' || waiting.some(item => item.lastErrorCode)) return 'failed';
  return waiting.length ? 'pending' : 'connected';
}

/** Reports null when the state cannot be read, and nothing until all three sources have answered. */
export function watchCalendarLink(db: Firestore, uid: string, next: (link: CalendarLink | null) => void) {
  let demo: boolean | undefined, integration: CalendarIntegration | null | undefined, items: CalendarItem[] | undefined;
  let active = true;
  const publish = () => {
    if (active && demo !== undefined && integration !== undefined && items) next({ demo, state: calendarState(integration, items) });
  };
  const fail = () => { if (active) next(null); };
  const stops = [
    onSnapshot(doc(db, 'demoAccounts', uid), snapshot => { demo = snapshot.exists(); publish(); }, fail),
    onSnapshot(doc(db, 'students', uid, 'integrations', 'calendar'), snapshot => {
      integration = (snapshot.data() as CalendarIntegration | undefined) ?? null; publish();
    }, fail),
    onSnapshot(collection(db, 'students', uid, 'calendarItems'), snapshot => {
      items = snapshot.docs.map(row => row.data() as CalendarItem); publish();
    }, fail),
  ];
  return () => { active = false; stops.forEach(stop => stop()); };
}
