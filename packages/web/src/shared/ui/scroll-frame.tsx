import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import './scroll-frame.css';

export function useScrollEdges(ref: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setEdges({ left: element.scrollLeft > 1,
      right: element.scrollWidth - element.clientWidth - element.scrollLeft > 1 });
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => { element.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [ref]);
  return edges;
}

export function ScrollFrame({ children, label, className = '', scrollRef }: {
  children: ReactNode; label: string; className?: string; scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const local = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? local;
  const edges = useScrollEdges(ref);
  return <div className="td-scroll-frame" data-left={edges.left} data-right={edges.right}>
    <div ref={ref} className={`td-scroll-area ${className}`} tabIndex={0} role="region" aria-label={label}>{children}</div>
  </div>;
}
