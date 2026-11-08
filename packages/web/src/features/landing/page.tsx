import { useEffect, useRef, useState } from 'react';
import { Reveal, Splash, Staged } from '../../shared/ui/motion';
import { PublicDemoEntry } from '../../shared/auth/public-demo-entry';
import { TodokuLogo } from '../../shared/ui/todoku-logo';
import './landing.css';
import { HeroVisual } from './hero-visual';
import { settleChapters } from './chapter-scroll';

const repository = 'https://github.com/Devfest-Hackathon-2026/df-2026-t198';
const chapters = [
  { id: 'home', label: 'トップ' }, { id: 'how', label: 'しくみ' },
  { id: 'people', label: '使う人' }, { id: 'try', label: '体験する' },
  { id: 'start', label: '使い始める' }, { id: 'privacy', label: '情報の扱い' },
];

function Screenshot({ name, alt, width, height }: { name: string; alt: string; width: number; height: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <figure className="product-shot">
    <button className="shot-trigger" type="button" aria-label={`${alt}を拡大する`} onClick={() => dialog.current?.showModal()}>
      <img className="shot" src={`/landing/${name}.png`} alt={alt} width={width} height={height} loading="lazy" />
      <span className="shot-caption">{alt}<span aria-hidden="true"> ↗</span></span>
    </button>
    <dialog ref={dialog} className="shot-dialog" aria-label={alt} onClick={event => {
      if (event.target === event.currentTarget) dialog.current?.close();
    }}>
      <div className="shot-dialog-content">
        <form method="dialog"><button className="close-shot" aria-label="拡大表示を閉じる">閉じる <span aria-hidden="true">×</span></button></form>
        <img src={`/landing/${name}.png`} alt={alt} width={width} height={height} />
      </div>
    </dialog>
  </figure>;
}

function LocalDemo() {
  const [step, setStep] = useState<'initial' | 'extended' | 'opened'>('initial');
  const opened = step === 'opened';
  return <section className="panel local-demo" aria-labelledby="local-demo-title">
    <span className="lab">ログインなし・保存なし</span>
    <h3 className="pt" id="local-demo-title">動く見本</h3>
    <div className="mini" aria-live="polite" aria-atomic="true">
      <div className={`mc${opened ? ' hot' : ''}`}>
        <span className="cn">レポート作成法</span>
        {opened && <s className="old">11/11</s>}
        <span className="new">締切 {opened ? '11/12' : '11/11'}</span>
      </div>
      <div className="mm"><span className="mono">面談画面 ・ 支援担当</span><br />
        <b>第1回レポート</b><br />
        {opened ? '締切が 11/11 から 11/12 に変わりました' : '締切 11/11'}
      </div>
    </div>
    <p className="local-status" role="status">{step === 'extended' ? 'LMS の締切が変わりました。まだ時間割は変わりません' : ''}</p>
    <div className="btns demo-actions">
      <button className="btn sm" disabled={step !== 'initial'} onClick={() => setStep('extended')}>① 先生が締切を延ばす</button>
      <button className="btn sm on" disabled={step !== 'extended'} onClick={() => setStep('opened')}>② 学生が LMS を開く</button>
      <button className="undo" onClick={() => setStep('initial')}>戻す</button>
    </div>
  </section>;
}

function DemoEntries() {
  return <div className="entry-grid">
    <section className="entry-panel" aria-labelledby="judge-title">
      <span className="eyebrow" lang="en">For judges</span>
      <h3 id="judge-title">審査員の方</h3>
      <p>説明資料の体験用アカウントでログインしてください。</p>
      <a className="pill primary" href="/demo-lms">体験用LMSを開く <span aria-hidden="true">↗</span></a>
      <a className="text-link" href="/session">面談画面を開く <span aria-hidden="true">↗</span></a>
    </section>
    <section className="entry-panel" aria-labelledby="shared-title">
      <span className="eyebrow" lang="en">Try it now</span>
      <h3 id="shared-title">その場で試す</h3>
      <span className="entry-kind">共用の体験版</span>
      <PublicDemoEntry />
      <a className="pill shared-fallback" href="/demo-lms">体験用LMSを開く <span aria-hidden="true">↗</span></a>
    </section>
  </div>;
}

export function LandingPage() {
  const [current, setCurrent] = useState('home');
  useEffect(() => {
    document.documentElement.classList.add('landing-scroll');
    const visibleChapters = new Map<string, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleChapters.set(entry.target.id, entry);
        else visibleChapters.delete(entry.target.id);
      }
      const visible = [...visibleChapters.values()].sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setCurrent(visible.target.id);
    }, { rootMargin: '-15% 0px -40% 0px', threshold: [0, .1, .3] });
    const sections = chapters.map(chapter => document.getElementById(chapter.id)).filter((section): section is HTMLElement => !!section);
    for (const section of sections) observer.observe(section);
    const stopSettling = settleChapters(sections);
    return () => { observer.disconnect(); stopSettling(); document.documentElement.classList.remove('landing-scroll'); };
  }, []);
  return <div className="landing brand"><Splash />
    <header className="landing-header">
      <a className="landing-home" href="/" aria-label="ToDoku ホーム"><TodokuLogo /></a>
      <nav aria-label="目次"><a href="#how">しくみ</a><a href="#people">使う人</a><a href="#try">体験する</a><a href="#start">使い始める</a></nav>
    </header>
    <nav className="chapter-nav" aria-label="現在地">{chapters.map(chapter => <a key={chapter.id} href={`#${chapter.id}`} aria-label={chapter.label} aria-current={current === chapter.id ? 'location' : undefined}><span>{chapter.label}</span></a>)}</nav>
    <main>
      <section className="hero chapter" id="home" aria-labelledby="landing-title">
        <Staged className="hero-copy">
          <h1 id="landing-title"><span>学生がすることは、</span><span>いつものLMSを</span><span>開くことだけです</span></h1>
          <p className="hero-lead">授業ごとの課題と締切をまとめ、その日にやることを毎朝メールで届けます。</p>
          <div className="hero-actions"><a className="pill primary" href="#try">体験版を開く <span aria-hidden="true">↗</span></a><a className="text-link" href="#start">自分の大学で使う <span aria-hidden="true">↗</span></a></div>
        </Staged>
        <HeroVisual />
        <a className="next-chapter" href="#how">しくみ <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter how-section" id="how" aria-labelledby="how-title">
        <Reveal><div className="section-heading"><span className="eyebrow" lang="en">How it works</span><h2 id="how-title">しくみ</h2><p>LMSの課題と締切を時間割とGoogle カレンダーに入れ、その日にやることを毎朝メールで送ります。</p></div></Reveal>
        <div className="product-grid">
          <Reveal><div className="product-label"><span className="step-number">01</span><h3>LMSの課題</h3></div><Screenshot name="lms" alt="体験用LMSの授業一覧" width={868} height={535} /></Reveal>
          <Reveal order={1}><div className="product-label"><span className="step-number">02</span><h3>時間割と締切の変更</h3></div><Screenshot name="updated" alt="締切変更後の学生画面" width={884} height={635} /></Reveal>
        </div>
        <a className="next-chapter" href="#people">使う人 <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter people-section" id="people" aria-labelledby="people-title">
        <Reveal><div className="section-heading"><span className="eyebrow" lang="en">Who it is for</span><h2 id="people-title">使う人</h2></div></Reveal>
        <div className="product-grid">
          <Reveal><h3>学生</h3><Screenshot name="student" alt="学生の時間割" width={884} height={635} /></Reveal>
          <Reveal order={1}><h3>支援担当（カウンセラーなど）</h3><Screenshot name="session" alt="支援担当の面談画面" width={1072} height={1005} /></Reveal>
        </div>
        <a className="next-chapter" href="#try">体験する <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter try-section" id="try" aria-labelledby="try-title">
        <Reveal><div className="section-heading"><span className="eyebrow" lang="en">Try ToDoku</span><h2 id="try-title">体験する</h2></div></Reveal>
        {/* Replace the incumbent local example with issue 225's shared three-panel component after it merges. */}
        <div id="landing-demo-slot"><Reveal><LocalDemo /></Reveal></div>
        <Reveal><DemoEntries /></Reveal>
        <a className="next-chapter" href="#start">使い始める <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter start-section" id="start" aria-labelledby="start-title">
        <Reveal><div className="section-heading"><span className="eyebrow" lang="en">Getting started</span><h2 id="start-title">使い始める</h2></div></Reveal>
        <Reveal><ol className="setup-steps">
          <li><span className="step-number">01</span><h3>Chrome 拡張</h3><a className="pill" href={`${repository}#手元で動かす`}>開発版の導入手順を開く <span aria-hidden="true">↗</span></a></li>
          <li><span className="step-number">02</span><h3>Google ログイン</h3><a className="pill" href="/student">学生画面を開く <span aria-hidden="true">↗</span></a></li>
          <li><span className="step-number">03</span><h3>対応しているLMS</h3><p>横浜国立大学のLMS</p></li>
        </ol></Reveal>
        <a className="next-chapter" href="#privacy">情報の扱い <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter privacy-section" id="privacy" aria-labelledby="privacy-title">
        <Reveal><div className="section-heading"><span className="eyebrow" lang="en">Privacy</span><h2 id="privacy-title">情報の扱い</h2></div>
          <ul className="privacy-list"><li>LMS のパスワードを預かりません</li><li>LMS に提出や書き込みをしません</li><li>メールは本人にだけ届きます</li><li>支援担当が見られるのは、共有を許可した学生の情報だけです</li></ul>
        </Reveal>
        <a className="pill" href="#home">トップに戻る <span aria-hidden="true">↑</span></a>
      </section>
    </main>
    <footer className="landing-footer"><a href="/" aria-label="ToDoku ホーム"><TodokuLogo /></a><span>TEAM ORANGE<br />DEVFEST GDGoC JAPAN HACKATHON 2026</span><a href={repository}>GitHub ↗</a></footer>
  </div>;
}
