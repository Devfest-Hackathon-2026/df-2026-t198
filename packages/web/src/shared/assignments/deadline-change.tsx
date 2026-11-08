import { useEffect, useRef, useState } from 'react';

// Keep event identity here: a calendar event moves between day cells on update.
export function useDeadlineChanges(values: ReadonlyMap<string, string>) {
  const previous = useRef(values);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    for (const [id, value] of values) {
      if (!previous.current.has(id) || previous.current.get(id) === value) continue;
      clearTimeout(timers.current.get(id));
      setChanged(current => new Set(current).add(id));
      timers.current.set(id, setTimeout(() => {
        setChanged(current => { const next = new Set(current); next.delete(id); return next; });
        timers.current.delete(id);
      }, 8000));
    }
    for (const id of previous.current.keys()) {
      if (values.has(id)) continue;
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      setChanged(current => { const next = new Set(current); next.delete(id); return next; });
    }
    previous.current = values;
  }, [values]);
  useEffect(() => {
    const active = timers.current;
    return () => { active.forEach(clearTimeout); active.clear(); };
  }, []);
  return changed;
}

export function ChangedDeadline({ value, previous, highlight }: { value: string; previous?: string | undefined; highlight?: boolean }) {
  const changed = useDeadlineChanges(new Map([['deadline', value]]));
  const [display, setDisplay] = useState<{ current: string; previous?: string }>({ current: value });
  if (display.current !== value) setDisplay({ current: value, previous: display.current });
  const active = highlight ?? changed.has('deadline');
  const before = previous ?? display.previous;
  return <span className={`deadline${active ? ' changed' : ''}`}>
    {active && before && <s className="previous-deadline" aria-label="変更前">{before}</s>}{value}
  </span>;
}
