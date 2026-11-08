import { flushSync } from 'react-dom';
import { reducedMotion } from './ui/motion';
import { useEffect, useState } from 'react';

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = (event: PopStateEvent) => {
      const update = () => setPath(window.location.pathname);
      if (!document.startViewTransition || reducedMotion() || event.hasUAVisualTransition) { update(); return; }
      const transition = document.startViewTransition(() => flushSync(update));
      // A skipped animation must never interrupt navigation.
      void transition.finished.catch(() => {});
    };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return path;
}
