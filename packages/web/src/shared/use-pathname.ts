import { flushSync } from 'react-dom';
import { reducedMotion } from './ui/motion';
import { useEffect, useState } from 'react';

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = (event: PopStateEvent) => {
      const next = window.location.pathname;
      if (next === path) return;
      const update = () => setPath(next);
      if (!document.startViewTransition || reducedMotion() || event.hasUAVisualTransition) { update(); return; }
      const transition = document.startViewTransition(() => flushSync(update));
      // A skipped animation must never interrupt navigation.
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {});
    };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, [path]);
  return path;
}
