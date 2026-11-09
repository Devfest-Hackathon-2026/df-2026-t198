import { useEffect, useRef, useState } from 'react';
import './mechanism.css';
import { reducedMotion } from '../../shared/ui/motion';

const statuses = ['先生のお知らせ', '先生がお知らせを出しました', 'LMSで課題の締切が変わりました',
  '学生がLMSを開き、課題を取り込んでいます', '時間割とカレンダーの締切が更新されました',
  '支援担当の画面も更新されました', '同じ締切になりました'];
const slideDuration = 1800;

function Deadline({ changed }: { changed: boolean }) {
  return <span className="flow-deadline">{changed && <s>11/12</s>}<strong>{changed ? '11/13' : '11/12'} 17:00</strong></span>;
}

function Schedule({ calendar, moved }: { calendar?: boolean; moved: boolean }) {
  return <div className={`flow-schedule${moved ? ' is-moved' : ''}`}>
    <h4>{calendar ? 'カレンダー' : '時間割と締切'}</h4>
    <div className="flow-days"><span>11/12（木）</span><span>11/13（金）</span></div>
    <div className="flow-track">
      <div className="flow-event"><span>第3回レポート（要約と引用）</span><Deadline changed={moved} /></div>
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
    // The first card starts on entry; each of the five cards gets the same reading time.
    const timers = statuses.slice(1).map((_, index) => window.setTimeout(() => setStep(index + 1), index * slideDuration));
    return () => timers.forEach(window.clearTimeout);
  }, [visible, reduced, replay]);
  const stage = reduced ? 6 : step;
  const card = (index: number, name: string) => `flow-card ${name}${stage === index || (stage === 0 && index === 1) ? ' is-active' : ''}`;
  return <div ref={container} className="mechanism" role="group" aria-label="締切変更の流れ" data-stage={stage}>
    <div className="flow-progress" aria-label={stage === 6 ? '全体' : `${Math.max(1, stage)} / 5`}>
      <span>{stage === 6 ? '全体' : `${Math.max(1, stage)} / 5`}</span>
      <span className="flow-dots" aria-hidden="true">{[1, 2, 3, 4, 5].map(index => <i key={index} className={stage >= index ? 'is-past' : ''} />)}</span>
      <span className="flow-status" role="status">{statuses[stage]}</span>
    </div>
    <div className={`flow-board${stage === 6 ? ' is-overview' : ''}`}>
      <div className={card(1, 'flow-teacher')} aria-hidden={stage !== 6 && stage > 1}>
        <div className="flow-content"><span className="flow-label">01 先生</span><h3>お知らせ</h3>
          <p className="flow-notice">{stage >= 1 ? 'レポートの締切を11/13に延ばします。' : '第3回レポート（要約と引用）'}</p>
        </div>
      </div>
      <div className={card(2, 'flow-lms')} aria-hidden={stage !== 2 && stage !== 6}>
        <div className="flow-content lms-skin"><div className="flow-lms-header"><strong>授業支援システム</strong><span>文章表現</span></div>
          <div className="flow-lms-body"><span className="flow-label">02 LMS</span><h3>課題の締切</h3>
            <p className="flow-lms-notice">{stage >= 2 ? 'お知らせ 1件：レポートの締切変更' : 'お知らせ 0件'}</p>
            <p>第3回レポート（要約と引用）</p><Deadline changed={stage >= 2} />
          </div>
        </div>
      </div>
      <div className={card(3, 'flow-import')} aria-hidden={stage !== 3 && stage !== 6}>
        <div className="flow-content"><span className="flow-label">03 ToDoku</span><h3>LMSからの取り込み</h3>
          <div className="flow-open"><span>LMSを開く</span><span aria-hidden="true">→</span><strong>{stage >= 4 ? '取り込み済み' : '課題の取り込み中'}</strong></div>
        </div>
      </div>
      <div className={card(4, 'flow-student')} aria-hidden={stage !== 4 && stage !== 6}>
        <div className="flow-content app"><span className="flow-label">04 学生</span><h3>時間割とカレンダー</h3>
          <div className="flow-schedules"><Schedule moved={stage >= 4} /><Schedule calendar moved={stage >= 4} /></div>
        </div>
      </div>
      <div className={card(5, 'flow-supporter')} aria-hidden={stage !== 5 && stage !== 6}>
        <div className="flow-content app"><span className="flow-label">05 支援担当</span><h3>前回の面談からの変化</h3>
          <div className={`flow-change${stage >= 5 ? ' is-updated' : ''}`}><strong>第3回レポート（要約と引用）</strong>
            {stage >= 5 ? <Deadline changed /> : <span>変化なし</span>}
          </div>
        </div>
      </div>
    </div>
    <button className="flow-replay" type="button" hidden={reduced} disabled={stage < 6} onClick={() => { setStep(0); setReplay(value => value + 1); }}>もう一度見る</button>
  </div>;
}
