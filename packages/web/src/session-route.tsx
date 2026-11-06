import { useEffect, useState, type ComponentProps } from 'react';

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const changed = () => setPath(window.location.pathname);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return path;
}

export function sessionRoute(path: string) {
  const match = /^\/session\/([^/]+)(\/plan)?\/?$/.exec(path);
  if (!match) return { uid: '', planning: false };
  try { return { uid: decodeURIComponent(match[1]!), planning: !!match[2] }; }
  catch { return { uid: '', planning: false }; }
}

export function SessionLink(props: ComponentProps<'a'> & { href: string }) {
  return <a {...props} onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, '', props.href);
    window.dispatchEvent(new window.Event('popstate'));
  }} />;
}
