import { useEffect, useState } from 'react';

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = () => setPath(window.location.pathname);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return path;
}
