import { useEffect, useRef, useState } from 'react';
import { Reveal, Splash, Staged } from '../../shared/ui/motion';
import { PublicDemoEntry } from '../../shared/auth/public-demo-entry';
import { TodokuLogo } from '../../shared/ui/todoku-logo';
import './landing.css';
import { HeroVisual } from './hero-visual';
import { Mechanism } from './mechanism';

const repository = 'https://github.com/Devfest-Hackathon-2026/df-2026-t198';
const chapters = [
  { id: 'home', label: 'トップ' }, { id: 'people', label: '概要' },
  { id: 'how', label: 'しくみ' }, { id: 'start', label: '使い始める' },
  { id: 'privacy', label: '情報の扱い' }, { id: 'try', label: '体験する' },
];

function Screenshot({ name, alt, width, height, caption }: { name: string; alt: string; width: number; height: number; caption: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <figure className="product-shot">
    <button className="shot-trigger" type="button" aria-label={`${alt}を拡大する`} onClick={() => dialog.current?.showModal()}>
      <img className="shot" src={`/landing/${name}.png`} alt={alt} width={width} height={height} loading="lazy" />
      <span className="shot-zoom" aria-hidden="true">↗</span>
    </button>
    <figcaption>{caption}</figcaption>
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

function DemoEntries() {
  return <div className="trial-entry">
    <div className="trial-launch">
      <PublicDemoEntry showDescription={false} />
      <a className="pill primary shared-fallback" href="/demo-lms">体験用LMSを開く <span aria-hidden="true">↗</span></a>
    </div>
    <p className="judge-guide"><a className="judge-link" href="/demo-lms">審査員の方 <span aria-hidden="true">↗</span></a>：説明資料のリンクから開けます。</p>
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
    return () => { observer.disconnect(); document.documentElement.classList.remove('landing-scroll'); };
  }, []);
  return <div className="landing brand"><Splash />
    <header className="landing-header">
      <a className="landing-home" href="/" aria-label="ToDoku ホーム"><TodokuLogo /></a>
      <nav aria-label="目次"><a href="#people">概要</a><a href="#how">しくみ</a><a href="#start">使い始める</a><a href="#try">体験する</a></nav>
    </header>
    <nav className="chapter-nav" aria-label="現在地">{chapters.map(chapter => <a key={chapter.id} href={`#${chapter.id}`} aria-label={chapter.label} aria-current={current === chapter.id ? 'location' : undefined}><span>{chapter.label}</span></a>)}</nav>
    <main>
      <section className="hero chapter" id="home" aria-labelledby="landing-title">
        <Staged className="hero-copy">
          <h1 id="landing-title"><span>学生がすることは、</span><span>いつものLMSを</span><span>開くことだけです</span></h1>
          <p className="hero-lead">授業ごとの課題と締切を時間割にまとめ、支援担当と共有します。やることがある日は、朝にメールで知らせます。</p>
          <p className="hero-setup">はじめに一度だけ、Chrome 拡張を入れて Google でログインします。</p>
          <div className="hero-actions"><a className="pill primary" href="#try">体験版を開く <span aria-hidden="true">↗</span></a><a className="text-link" href="#start">自分の大学で使う <span aria-hidden="true">↗</span></a></div>
        </Staged>
        <HeroVisual />
        <a className="next-chapter" href="#people">概要 <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter people-section" id="people" aria-labelledby="people-title">
        <Reveal><div className="section-heading"><span className="chapter-number">01</span><h2 id="people-title">課題を一か所にまとめ、支援担当と共有します</h2></div></Reveal>
        <div className="product-grid people-grid">
          <Reveal><div className="person-statement"><h3>学生</h3><p><span>課題と締切が時間割にまとまり、</span><span>やることがある日は朝にメールが届きます。</span></p></div>
            <div className="person-thumb"><Screenshot name="student" alt="学生の時間割" width={782} height={498} caption="学生の時間割" /></div>
          </Reveal>
          <Reveal order={1}><div className="person-statement"><h3>支援担当（カウンセラーなど）</h3><p><span>学生と同じ課題の一覧を見て、</span><span>次にやることを一緒に決められます。</span></p></div>
            <div className="person-thumb"><Screenshot name="session" alt="支援担当の面談画面" width={1200} height={650} caption="面談の画面" /></div>
          </Reveal>
        </div>
        <a className="next-chapter" href="#how">しくみ <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter how-section" id="how" aria-labelledby="how-title">
        <Reveal><div className="section-heading"><span className="chapter-number">02</span><h2 id="how-title">しくみ</h2><p>締切が変わっても、学生と支援担当の画面にそろって出ます。</p></div></Reveal>
        <Mechanism />
        <a className="next-chapter" href="#start">使い始める <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter start-section" id="start" aria-labelledby="start-title">
        <Reveal><div className="section-heading"><span className="chapter-number">03</span><h2 id="start-title">導入</h2></div></Reveal>
        <Reveal><ol className="setup-steps">
          <li><span className="step-number">01</span><h3>Chrome 拡張</h3><a className="pill" href={`${repository}#手元で動かす`}>開発版の導入手順を開く <span aria-hidden="true">↗</span></a></li>
          <li><span className="step-number">02</span><h3>Google ログイン</h3><a className="pill" href="/student">学生画面を開く <span aria-hidden="true">↗</span></a></li>
        </ol>
          <div className="lms-support"><h3>対応しているLMS</h3><ul className="supported-lms"><li>横浜国立大学</li></ul></div>
        </Reveal>
        <a className="next-chapter" href="#privacy">情報の扱い <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter privacy-section" id="privacy" aria-labelledby="privacy-title">
        <Reveal><div className="section-heading"><span className="chapter-number">04</span><h2 id="privacy-title">情報の扱い</h2></div>
          <ul className="privacy-list"><li>LMS のパスワードを預かりません</li><li>LMSに課題の提出や書き込みをしません</li><li>メールは本人にだけ届きます</li><li>支援担当が見られるのは、共有を許可した学生の情報だけです</li></ul>
        </Reveal>
        <a className="next-chapter" href="#try">体験する <span aria-hidden="true">↓</span></a>
      </section>

      <section className="chapter try-section" id="try" aria-labelledby="try-title">
        <Reveal><div className="section-heading"><span className="chapter-number">05</span><h2 id="try-title">体験版</h2></div>
          <p className="trial-lead">架空の授業と課題で、学生と支援担当の画面を試せます。</p>
          <DemoEntries />
        </Reveal>
        <a className="next-chapter" href="#home">トップに戻る <span aria-hidden="true">↑</span></a>
      </section>
    </main>
    <footer className="landing-footer"><a href="/" aria-label="ToDoku ホーム"><TodokuLogo /></a><span>TEAM ORANGE<br />DEVFEST GDGoC JAPAN HACKATHON 2026</span><a href={repository}>GitHub ↗</a></footer>
  </div>;
}
