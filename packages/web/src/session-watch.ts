import { emptySession, type SessionData } from './session-model';

export type SessionState = { status: 'loading' | 'ready' | 'denied' | 'error'; data: SessionData };
export type SessionCollection = 'courses' | 'assignments' | 'changes' | 'fetchStates' | 'context' | 'plans';
export interface SessionSource {
  grant: (student: string, supporter: string, next: (allowed: boolean) => void, fail: () => void) => () => void;
  watch: <K extends SessionCollection>(student: string, collection: K, next: (value: SessionData[K]) => void,
    fail: () => void) => () => void;
}
export function watchSession(source: SessionSource, student: string, viewer: string,
  update: (state: SessionState) => void) {
  let active = true;
  let started = false;
  const stops: (() => void)[] = [];
  const data = emptySession();
  const received = new Set<SessionCollection>();
  const stop = () => { active = false; for (const unsubscribe of stops) unsubscribe(); };
  const fail = (status: 'denied' | 'error') => {
    if (!active) return;
    stop(); update({ status, data: emptySession() });
  };
  const start = () => {
    if (!active || started) return;
    started = true;
    const collections = ['courses', 'assignments', 'changes', 'fetchStates', 'context', 'plans'] as const;
    for (const collection of collections) {
      const unsubscribe = source.watch(student, collection, value => {
        if (!active) return;
        Object.assign(data, { [collection]: value });
        received.add(collection);
        if (received.size === collections.length) update({ status: 'ready', data: { ...data } });
      }, () => fail('error'));
      if (!active) unsubscribe(); else stops.push(unsubscribe);
    }
  };
  update({ status: 'loading', data: emptySession() });
  if (student === viewer) start();
  else {
    const unsubscribe = source.grant(student, viewer, allowed => {
      if (!allowed) fail('denied'); else start();
    }, () => fail('denied'));
    if (!active) unsubscribe(); else stops.push(unsubscribe);
  }
  return stop;
}
