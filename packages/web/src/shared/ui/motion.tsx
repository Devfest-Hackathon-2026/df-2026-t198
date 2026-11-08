import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TodokuLogo } from './todoku-logo';

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function Reveal({ children, order = 0, className = '' }: { children: ReactNode; order?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion() || typeof IntersectionObserver === 'undefined') return;
    // The default is visible, including when JavaScript or the observer is unavailable.
    element.dataset['reveal'] = 'waiting';
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { element.dataset['reveal'] = 'shown'; observer.disconnect(); }
    }, { threshold: 0.08 });
    observer.observe(element);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const stopMotion = () => { if (media?.matches) { delete element.dataset['reveal']; observer.disconnect(); } };
    media?.addEventListener('change', stopMotion);
    return () => { observer.disconnect(); media?.removeEventListener('change', stopMotion); delete element.dataset['reveal']; };
  }, []);
  return <div ref={ref} className={`td-reveal ${className}`} style={{ '--td-delay': `${Math.min(5, Math.max(0, order)) * 70}ms` } as CSSProperties}>{children}</div>;
}
/** Children appear in reading order: heading, main action, then supporting content. */
export function Staged({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`td-staged ${className}`}>{Children.toArray(children).map((child, index) =>
    <div key={index} className="td-stage" style={{ '--td-delay': `${Math.min(index, 4) * 100}ms` } as CSSProperties}>{child}</div>)}</div>;
}
const splashKey = 'todoku:intro-seen';
export function Splash() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined' || reducedMotion()) return false;
    try { return !window.sessionStorage.getItem(splashKey); } catch { return false; }
  });
  useEffect(() => {
    if (!visible) return;
    try { window.sessionStorage.setItem(splashKey, '1'); } catch { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(false), 1000);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const skipMotion = () => { if (media?.matches) setVisible(false); };
    media?.addEventListener('change', skipMotion);
    return () => { window.clearTimeout(timer); media?.removeEventListener('change', skipMotion); };
  }, [visible]);
  return visible ? <button type="button" className="td-splash brand" aria-label="紹介を開く" onClick={() => setVisible(false)}><TodokuLogo /></button> : null;
}
