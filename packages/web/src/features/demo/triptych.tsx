import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';
import { Button } from '../../shared/ui/button';
import { reducedMotion } from '../../shared/ui/motion';
import './demo.css';
import type { DemoScreen } from './screen-flow';
import type { CourseIdentity } from '../../shared/course-color';
import { useCourseColors } from '../../shared/course-color-context';

const roles = { lms: 'LMS', student: '学生', supporter: '支援担当' } as const;
type Pane = keyof typeof roles;
export function DemoTriptych({ lms, student, supporter, waiting = false, changed = false, screen }: {
  lms: ReactNode; student: ReactNode; supporter: ReactNode; waiting?: boolean; changed?: boolean; screen?: DemoScreen;
}) {
  const id = useId();
  const [localSelected, setSelected] = useState<Pane>('lms');
  const selected = screen?.selected ?? localSelected;
  return <div className={`demo-triptych ${screen ? 'demo-screen-flow' : ''}`} data-parallel={screen?.parallel ?? undefined}>
    <nav className="demo-pane-switch" aria-label="体験の画面">
      {(Object.keys(roles) as Pane[]).map(role => <Button key={role} variant="quiet" aria-pressed={selected === role}
        aria-label={roles[role]} aria-controls={`${id}-${role}`} onClick={() => screen ? screen.select(role) : setSelected(role)}>{screen ? <><span className="rd-demo-role" data-role={role} aria-hidden="true">{{ lms: '先', student: '学', supporter: '支' }[role]}</span><span className="rd-demo-role-label"><b>{{ lms: '体験用LMS', student: '学生の画面', supporter: '支援担当の画面' }[role]}</b><small>{role === 'lms' ? '大学の授業支援システム' : 'ToDoku'}</small></span>{role !== 'lms' && (waiting || changed) && <span className="rd-demo-dot" data-changed={changed && !waiting} title={waiting ? 'まだ前のまま' : '締切が変わった'} />}</> : roles[role]}</Button>)}
    </nav>
    {screen && <p className="rd-demo-caption" role="status">{screen.caption}</p>}
    {(Object.keys(roles) as Pane[]).map((role, index) => <section key={role} id={`${id}-${role}`} data-demo-pane={role}
      data-selected={selected === role} className={`demo-pane ${role === 'lms' ? 'lms-skin' : 'app'}`} aria-label={`${roles[role]}の画面`}>
      <header className="demo-pane-heading"><span aria-hidden="true">0{index + 1}</span><h2>{roles[role]}</h2>
        {role !== 'lms' && waiting && <span className="demo-waiting">まだLMSを開いていない</span>}</header>
      <div className="demo-pane-body">{{ lms, student, supporter }[role]}</div>
    </section>)}
  </div>;
}

export function DemoTask({ course, identity, title, due, stamp }: { course: string; identity?: CourseIdentity; title: string; due: string; stamp?: { day: string; weekday: string } | undefined }) {
  const courseColor = useCourseColors();
  return <article className="demo-observed-task" data-course-color={courseColor(identity)}>{stamp && <span className="rd-demo-task-day" aria-hidden="true"><b>{stamp.day}</b><small>{stamp.weekday}</small></span>}<p className="eyebrow course-label">{course}</p><h3>{title}</h3>
    <ChangedDeadline value={due} /></article>;
}

/** No Firebase, API, or saved state: the landing page can import this directly. */
export function DemoFlowPreview({ autoPlay = true }: { autoPlay?: boolean }) {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [reduced, setReduced] = useState(reducedMotion);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(!!media?.matches);
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    const timer = window.setTimeout(() => setStage(value => (value + 1) % 4), 3000);
    return () => window.clearTimeout(timer);
  }, [playing, reduced, stage]);
  const task = (extended: boolean) => <DemoTask course="文章表現" title="第3回レポート"
    due={`11/${extended ? '13 (金)' : '12 (木)'} 17:00`} />;
  return <div className="app demo-preview" aria-label="締切の変化の見本">
    <div className="demo-preview-controls"><span>{['LMSを開く前', '課題の初期状態', 'LMSの締切変更', '学生がLMSを開いた後'][stage]}</span>
      <Button variant="quiet" onClick={() => setPlaying(value => !value)} disabled={reduced}>{playing && !reduced ? '一時停止する' : '自動再生する'}</Button>
      <Button variant="quiet" data-demo-next onClick={() => { setPlaying(false); setStage(value => (value + 1) % 4); }}>次へ進む</Button>
    </div>
    <DemoTriptych key={stage === 0 ? 'initial' : 'flow'} waiting={stage === 2} lms={task(stage >= 2)}
      student={stage ? task(stage === 3) : <p className="demo-empty-view">LMSを開く前</p>}
      supporter={stage ? task(stage === 3) : <p className="demo-empty-view">LMSを開く前</p>} />
  </div>;
}
