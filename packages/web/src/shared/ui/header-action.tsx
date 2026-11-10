import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep account state and error handling with its page; place its action in the shell. */
export function HeaderAction({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setTarget(document.getElementById('rd-account-actions')); }, []);
  return target ? createPortal(children, target) : children;
}
