import { useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../../../shared/ui/motion';
import { StoryFilm } from './film';
import { storySteps, shortStorySteps, sceneEnd, storyCues, type StoryStep } from './timeline';
import { StorySound } from './sound';
import './player.css';

export { storySteps } from './timeline';

function Explanation({ step, steps }: { step: number; steps: readonly StoryStep[] }) {
  const item = steps[step];
  if (!item) return null;
  return <><span className="story-flow-number">{step + 1} / {steps.length}{'day' in item ? ` · ${item.day} ${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')} · ${item.place}` : ''}</span>
    <h3>{item.title}</h3><p className="story-flow-description">{item.lines.map((line, index) => <span key={index}>{line}</span>)}</p></>;
}

export function StoryPlayer({ autoplay = true, initialSound = false, short = false }: { autoplay?: boolean; initialSound?: boolean; short?: boolean }) {
  const steps = short ? shortStorySteps : storySteps;
  const container = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const clock = useRef(0);
  const audio = useRef<StorySound | null>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [reduced, setReduced] = useState(reducedMotion);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(!autoplay);
  const [finished, setFinished] = useState(false);
  const [sound, setSound] = useState(false);
  const playing = visible && foreground && !paused && !reduced && !finished;
  const last = steps.length - 1;
  useEffect(() => {
    audio.current = new StorySound();
    if (initialSound && !reducedMotion()) void audio.current.unlock().then(setSound);
    return () => { audio.current?.close(); audio.current = null; };
  }, [initialSound]);
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
    if (!playing) { audio.current?.stop(); return; }
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const before = clock.current;
      clock.current = Math.min(steps[step]!.duration, before + now - previous);
      previous = now;
      if (sound) for (const cue of storyCues[step] ?? []) {
        if (before < cue.at && clock.current >= cue.at) audio.current?.play(cue.sound);
      }
      setElapsed(clock.current);
      if (clock.current >= steps[step]!.duration) {
        if (step === last) setFinished(true);
        else { clock.current = 0; setElapsed(0); setStep(value => value + 1); }
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, step, sound, last, steps]);
  function move(delta: number) {
    const next = Math.max(0, Math.min(last, step + delta));
    setPaused(true);
    // A manually selected scene shows its completed action, without playing past events.
    clock.current = sceneEnd[next]!;
    setElapsed(clock.current);
    setStep(next);
    setFinished(next === last);
    audio.current?.stop();
  }
  function play() {
    if (finished) { setStep(0); clock.current = 0; setElapsed(0); setFinished(false); }
    else if (paused && clock.current >= sceneEnd[step]!) { clock.current = 0; setElapsed(0); }
    setPaused(value => finished ? false : !value);
  }
  return <div ref={container} className={`story-player${reduced ? ' is-static' : ''}`} role="group" aria-label="締切変更の流れ"
    tabIndex={reduced ? undefined : 0} data-stage={step + 1} data-elapsed={Math.round(elapsed)} data-playing={playing} data-finished={finished} data-sound={sound}
    onFocus={event => { if (event.target === event.currentTarget) setPaused(true); }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || reduced) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
    }}
    onTouchStart={event => { const point = event.touches[0]; if (point) touch.current = { x: point.clientX, y: point.clientY }; }}
    onTouchEnd={event => {
      const point = event.changedTouches[0]; const start = touch.current; touch.current = null;
      if (!point || !start || reduced) return;
      const dx = point.clientX - start.x; const dy = point.clientY - start.y;
      if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    }}>
    {reduced ? <div className="story-flow-static-grid">{steps.map((item, index) => <div className="story-flow-static-item" key={item.id}>
      <StoryFilm steps={steps} step={index} elapsed={sceneEnd[index]!} still /><div><Explanation step={index} steps={steps} /></div>
    </div>)}</div> : <>
      <div className="story-flow-status" role="status" aria-live="polite" aria-atomic="true"><Explanation step={step} steps={steps} /></div>
      <StoryFilm steps={steps} step={step} elapsed={elapsed} />
      <div className="story-flow-footer"><div className="story-flow-controls">
        <button type="button" aria-label="前の段へ" disabled={step === 0} onClick={() => move(-1)}>← 前へ</button>
        <button type="button" aria-label={finished ? '最初から再生する' : paused ? '再生する' : '一時停止する'} onClick={play}>{finished ? '最初から' : paused ? '再生' : '一時停止'}</button>
        <button type="button" aria-label="次の段へ" disabled={step === last} onClick={() => move(1)}>次へ →</button>
        <button type="button" className="story-flow-sound" aria-label={sound ? '音を消す' : '音を出す'} aria-pressed={sound} onClick={() => {
          if (sound) { audio.current?.stop(); setSound(false); }
          else void audio.current?.unlock().then(setSound);
        }}>{sound ? '音あり' : '音なし'}</button>
      </div><span className="story-flow-play-state">{finished ? '再生が終わりました' : playing ? '自動再生中' : '停止中'}</span></div>
      <div className="story-flow-progress" role="progressbar" aria-label="しくみの進み具合" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={finished ? steps.length : step} aria-valuetext={`${step + 1} / ${steps.length}`}>
        {steps.map((item, index) => <span key={item.id}><i style={{ transform: `scaleX(${index < step || finished ? 1 : index === step ? elapsed / item.duration : 0})` }} /></span>)}
      </div>
    </>}
  </div>;
}

export default function StorySlides() {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const resize = () => { if (canvas.current) canvas.current.style.transform = `scale(${element.clientWidth / 1280})`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const query = new URLSearchParams(window.location.search);
  return <main className="brand story-slides"><div ref={frame} className="story-slide-frame"><div ref={canvas} className="story-slide-canvas">
    <StoryPlayer autoplay={query.get('autoplay') === '1'} initialSound={query.get('sound') === '1'} short={query.get('short') === '1'} />
  </div></div></main>;
}
