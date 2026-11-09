import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../../shared/ui/motion';
import { MechanismScene } from './mechanism-scene';
import './mechanism.css';

export const mechanismSteps = [
  { title: '先生の締切変更', lines: ['先生がLMSで、レポートの締切を', '11/12から11/13に延ばします。'] },
  { title: '学生のLMS閲覧', lines: ['学生はいつもどおり、', 'LMSを開きます。'] },
  { title: 'ToDokuへの取り込み', lines: ['拡張機能が変更後の締切を読み取り、', 'ToDokuの台帳に記録します。'] },
  { title: '予定の更新', lines: ['学生のカレンダーと時間割で、', '締切が11/12から11/13に移ります。'] },
  { title: '面談画面の変化', lines: ['学生が共有を許可していれば、', '支援担当の画面にも変更が表示されます。'] },
  { title: '翌朝のメール', lines: ['翌朝7:30、学生本人に', '「今日やること」のメールが届きます。'] },
];
const duration = 5000;

function Explanation({ step }: { step: number }) {
  const item = mechanismSteps[step];
  if (!item) return null;
  return <><span className="flow-number">{step + 1} / 6</span><h3>{item.title}</h3>
    <p className="flow-description">{item.lines.map(line => <span key={line}>{line}</span>)}</p></>;
}

export function Mechanism({ autoplay = true }: { autoplay?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [reduced, setReduced] = useState(reducedMotion);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(!autoplay);
  const [hovered, setHovered] = useState(false);
  const [finished, setFinished] = useState(false);
  const playing = visible && foreground && !paused && !hovered && !reduced && !finished;
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    const visibility = () => setForeground(!document.hidden);
    query.addEventListener('change', change);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .45));
    }, { threshold: [0, .45] });
    if (container.current) observer.observe(container.current);
    return () => { observer.disconnect(); query.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (step === 5) setFinished(true);
      else setStep(value => value + 1);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [playing, step]);
  function move(delta: number) {
    const next = Math.max(0, Math.min(5, step + delta));
    setPaused(true);
    setStep(next);
    setFinished(next === 5);
  }
  return <div ref={container} className={`mechanism${reduced ? ' is-static' : ''}`} role="group" aria-label="締切変更の流れ"
    tabIndex={reduced ? undefined : 0} data-stage={step + 1} data-playing={playing} data-finished={finished}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={event => { if (event.target === event.currentTarget) setPaused(true); }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
    }}
    onTouchStart={event => { const point = event.touches[0]; if (point) touch.current = { x: point.clientX, y: point.clientY }; }}
    onTouchEnd={event => {
      const point = event.changedTouches[0]; const start = touch.current; touch.current = null;
      if (!point || !start) return;
      const dx = point.clientX - start.x; const dy = point.clientY - start.y;
      if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    }}>
    {reduced ? <div className="flow-static-grid">{mechanismSteps.map((item, index) => <div className="flow-static-item" key={item.title}>
      <MechanismScene step={index} compact /><div><Explanation step={index} /></div>
    </div>)}</div> : <>
      <div className="flow-slide"><MechanismScene step={step} />
        <div className="flow-copy"><div className="flow-status" role="status" aria-live="polite" aria-atomic="true"><Explanation step={step} /></div>
          <div className="flow-controls">
            <button type="button" aria-label="前の段へ" disabled={step === 0} onClick={() => move(-1)}>← 前へ</button>
            <button type="button" aria-label={finished ? '最初から再生する' : paused ? '再生する' : '一時停止する'} onClick={() => {
              if (finished) { setStep(0); setFinished(false); setPaused(false); }
              else setPaused(value => !value);
            }}>{finished ? '最初から' : paused ? '再生' : '一時停止'}</button>
            <button type="button" aria-label="次の段へ" disabled={step === 5} onClick={() => move(1)}>次へ →</button>
          </div>
          <span className="flow-play-state">{finished ? '再生が終わりました' : playing ? '自動再生中' : '停止中'}</span>
        </div>
      </div>
      <div className="flow-progress" role="progressbar" aria-label="しくみの進み具合" aria-valuemin={0} aria-valuemax={6} aria-valuenow={finished ? 6 : step} aria-valuetext={`${step + 1} / 6`}>
        {mechanismSteps.map((item, index) => <span className={index < step || finished ? 'is-past' : index === step ? 'is-current' : ''} key={item.title}>
          <i key={`${index}-${step}-${playing}`} style={{ animationPlayState: playing ? 'running' : 'paused' }} />
        </span>)}
      </div>
    </>}
  </div>;
}

export function MechanismSlides() {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const resize = () => {
      if (canvas.current) canvas.current.style.transform = `scale(${element.clientWidth / 1280})`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <main className="brand mechanism-slides"><div ref={frame} className="mechanism-slide-frame"><div ref={canvas} className="mechanism-slide-canvas">
    <Mechanism autoplay={new URLSearchParams(window.location.search).get('autoplay') === '1'} />
  </div></div></main>;
}
