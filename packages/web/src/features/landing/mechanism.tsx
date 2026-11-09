import { useEffect, useRef, useState } from 'react';
import './mechanism.css';
import { reducedMotion } from '../../shared/ui/motion';

const statuses = ['先生のお知らせ', '先生がお知らせを出しました', 'LMSの締切が変わりました',
  '学生がLMSを開きました', '課題の読み取り中',
  '時間割とカレンダーの締切を更新しました', '支援担当の画面も更新しました'];

// Each part enlarges briefly at the step where it changes, so the eye follows the change.
const pulse = (on: boolean) => on ? ' flow-pulse' : '';

function Deadline({ changed, emphasize = false }: { changed: boolean; emphasize?: boolean }) {
  return <span className={`flow-deadline${pulse(emphasize)}`}>{changed && <s>11/12</s>}<strong>{changed ? '11/13' : '11/12'} 17:00</strong></span>;
}

function Schedule({ calendar, moved, emphasize }: { calendar?: boolean; moved: boolean; emphasize: boolean }) {
  return <div className={`flow-schedule app${moved ? ' is-moved' : ''}${pulse(emphasize)}`}>
    <h3>{calendar ? 'カレンダー' : '時間割と締切'}</h3>
    <div className="flow-days"><span>11/12（木）</span><span>11/13（金）</span></div>
    <div className="flow-track">
      <div className="flow-event"><span>書き方を書くレポート</span><Deadline changed={moved} emphasize={emphasize} /></div>
    </div>
  </div>;
}

export function Mechanism() {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(reducedMotion);
  const [step, setStep] = useState(0);
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { threshold: .45 });
    if (container.current) observer.observe(container.current);
    return () => { query.removeEventListener('change', change); observer.disconnect(); };
  }, []);
  useEffect(() => {
    if (!visible || reduced) return;
    const timers = statuses.slice(1).map((_, index) => window.setTimeout(() => setStep(index + 1), (index + 1) * 1400));
    return () => timers.forEach(window.clearTimeout);
  }, [visible, reduced, replay]);
  const stage = reduced ? 6 : step;
  return <div ref={container} className="mechanism" role="group" aria-label="締切変更の流れ">
    <div className="flow-source">
      <div className={`flow-teacher${stage >= 1 ? ' is-issued' : ''}${pulse(stage === 1)}`}>
        <span className="flow-label">01 先生</span>
        <h3>お知らせ</h3>
        <p className="flow-notice">{stage >= 1 ? 'レポートの締切を11/13に延ばします。' : '書き方を書くレポート'}</p>
      </div>
      <span className="flow-arrow" aria-hidden="true">→</span>
      <div className="flow-lms lms-skin">
        <div className="flow-lms-header"><strong>授業支援システム</strong><span>文章表現</span></div>
        <div className="flow-lms-body"><span className="flow-label">02 LMS</span>
          <p className={`flow-lms-notice${pulse(stage === 2)}`}>{stage >= 2 ? 'お知らせ 1件：レポートの締切変更' : 'お知らせ 0件'}</p>
          <p>書き方を書くレポート</p><Deadline changed={stage >= 2} emphasize={stage === 2} />
          <span className={`flow-open${stage >= 3 ? ' is-open' : ''}${pulse(stage === 3)}`}>{stage >= 3 ? '学生がLMSを開きました' : 'LMSを開く前'}</span>
        </div>
      </div>
    </div>
    <div className="flow-bridge"><span aria-hidden="true">↓</span><span>03 ToDoku</span><span className="flow-status" role="status">{statuses[stage]}</span></div>
    <div className="flow-destinations">
      {/* Keep the class into step 6: the pop starts after the 1.2s slide and outlasts step 5. */}
      <Schedule moved={stage >= 5} emphasize={stage >= 5 && !reduced} /><Schedule calendar moved={stage >= 5} emphasize={stage >= 5 && !reduced} />
      <div className={`flow-supporter app${stage >= 6 ? ' is-updated' : ''}${pulse(stage === 6 && !reduced)}`}>
        <h3>支援担当</h3><p>前回の面談からの変化</p>
        <strong>書き方を書くレポート</strong>
        {stage >= 6 ? <Deadline changed emphasize={!reduced} /> : <span>変化なし</span>}
      </div>
    </div>
    <button className="flow-replay" type="button" hidden={reduced} disabled={stage < 6} onClick={() => { setStep(0); setReplay(value => value + 1); }}>もう一度見る</button>
  </div>;
}
