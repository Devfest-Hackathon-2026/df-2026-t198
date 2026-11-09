import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../../shared/ui/motion';

export type DemoPane = 'lms' | 'student' | 'supporter';
const captions = {
  lms: 'LMSの締切が変わりました。学生と支援担当の画面は、次の読み取りまで前のままです',
  student: '読み取りました。学生の画面です',
  supporter: '支援担当の画面にも、同じ変更が出ています',
};

/** Each operation owns a ticket so a late response cannot restart a cancelled tour. */
export function useDemoScreen(ready: boolean) {
  const [selected, setSelected] = useState<DemoPane>('lms');
  const [parallel, setParallel] = useState(false);
  const [automatic, setAutomatic] = useState(true);
  const [reduced, setReduced] = useState(reducedMotion);
  const [caption, setCaption] = useState('LMSの画面です');
  const [sequence, setSequence] = useState<{ extended: boolean; step: 'confirmed' | 'student' } | null>(null);
  const ticket = useRef(0);
  const allowed = automatic && !reduced;
  function cancel() { ticket.current++; setSequence(null); }
  function select(pane: DemoPane) {
    cancel(); setSelected(pane);
    setCaption(pane === 'lms' ? 'LMSの画面です' : ready ? captions[pane] : `${pane === 'student' ? '学生' : '支援担当'}の画面です`);
  }
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => { setReduced(!!media?.matches); if (media?.matches) cancel(); };
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!sequence || !allowed || !ready) return;
    const timer = window.setTimeout(() => {
      if (sequence.step === 'confirmed') {
        setSelected('student'); setCaption(captions.student);
        setSequence(sequence.extended ? { ...sequence, step: 'student' } : null);
      } else {
        setSelected('supporter'); setCaption(captions.supporter); setSequence(null);
      }
    }, sequence.step === 'student' ? 2500 : sequence.extended ? 0 : 800);
    return () => window.clearTimeout(timer);
  }, [sequence, allowed, ready]);
  return {
    selected, parallel, automatic, reduced, caption, select,
    toggleParallel() { cancel(); setParallel(value => !value); },
    toggleAutomatic() { cancel(); setAutomatic(value => !value); },
    begin() { cancel(); setSelected('lms'); setCaption('LMSを読み取っています…'); return ticket.current; },
    changed(operation: number) { if (operation === ticket.current) setCaption(captions.lms); },
    complete(operation: number, extended: boolean) {
      if (operation !== ticket.current) return;
      setCaption('読み取りが終わりました。表示する画面を選べます');
      if (allowed) setSequence({ extended, step: 'confirmed' });
    },
    reset() { cancel(); setSelected('lms'); setCaption('LMSの画面です'); },
  };
}
export type DemoScreen = ReturnType<typeof useDemoScreen>;
