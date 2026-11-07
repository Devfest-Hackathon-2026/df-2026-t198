import { useState } from 'react';
import { PublicDemoEntry } from './public-demo-entry';
import { TodokuLogo } from './todoku-logo';
import './landing.css';

const repository = 'https://github.com/Devfest-Hackathon-2026/df-2026-t198';

function LocalDemo() {
  const [step, setStep] = useState<'initial' | 'extended' | 'opened'>('initial');
  const opened = step === 'opened';
  return <section className="panel local-demo" aria-labelledby="local-demo-title">
    <span className="lab">ログインなし</span>
    <h3 className="pt" id="local-demo-title">動く見本</h3>
    <p className="pd">先生が締切を延ばしてから、学生が LMS を開くまでの変化を、順に押して見られます。この画面の中だけで動き、何も保存しません。</p>
    <div className="mini" aria-live="polite" aria-atomic="true">
      <div className={`mc${opened ? ' hot' : ''}`}>
        <span className="cn">レポートの書き方の書き方</span>
        {opened && <s className="old">11/11</s>}
        <span className="new">締切 {opened ? '11/12' : '11/11'}</span>
      </div>
      <div className="mm"><span className="mono">面談画面 ・ 支援担当</span><br />
        <b>書き方を書くレポート</b><br />
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

function SharedDemo() {
  return <section className="panel shared-demo" aria-labelledby="shared-demo-title">
    <span className="lab">本物の体験版</span>
    <h3 className="pt" id="shared-demo-title">共用の体験版<span className="tag">架空の授業</span></h3>
    <p className="pd shared-description">誰でも使える共用の体験です。延長、お知らせの読み取り（Gemini）、面談画面の変化まで、本物の画面で試せます。</p>
    <PublicDemoEntry />
    <p className="note"><b>審査の方へ</b> 説明資料に書いた体験用アカウントで入ってください。ほかの人の操作と混ざりません。</p>
    <a className="demo-lms-link" href="/demo-lms">体験用LMSを開く</a>
  </section>;
}

export function LandingPage() {
  return <div className="landing">
  <header className="top">
    <a className="brand" href="/" aria-label="ToDoku ホーム"><TodokuLogo /></a>
    <a className="menu" href="#contents">目次</a>
    <nav className="nav" id="contents" aria-label="目次"><a href="#how">しくみ</a><a href="#try">体験する</a><a href="#start">使い始める</a><a href={repository}>GitHub</a></nav>
  </header>

  <main>
  <section className="hero" aria-labelledby="landing-title">
    <div className="hl">
      <div className="lab">大学の課題のための Chrome 拡張と Web の画面</div>
      <h1 className="h1" id="landing-title">学生がすることは、<br />いつもの LMS を<br />開くことだけです。</h1>
      <p className="lead">開くたびに、全部の授業の課題が集まります。締切は時間割と Google カレンダーに入り、次にやることは朝に Gmail で届きます。<span className="pc-only">支援担当の面談画面にも、同じ状況が出ます。</span></p>
      <div className="btns"><a className="btn on" href="#try">体験版を開く</a><a className="btn" href="#start">自分の大学で使う</a>
      </div>
    </div>
    <div className="vis" aria-hidden="true">
    <div className="grid">
      <div className="gh"></div><div className="gh">月</div><div className="gh">火</div><div className="gh">水</div><div className="gh">木</div><div className="gh">金</div>
      <div className="gp">1</div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">Re:線形代数</span><span className="nx">締切 11/18</span></div></div>
      <div className="gc"><div className="cell"><span className="cn">自転車置き場の社会学</span><span className="nx">締切 11/19</span></div></div>
      <div className="gc"></div><div className="gc"></div>
      <div className="gp">2</div>
      <div className="gc"><div className="cell hot"><span className="cn">レポートの書き方の書き方</span><span className="nx">締切 11/11</span></div></div>
      <div className="gc"></div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">90分の数理</span><span className="nx">課題なし</span></div></div>
      <div className="gp">3</div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">学食経済学</span><span className="nx">提出済み</span></div></div>
      <div className="gc"></div><div className="gc"></div>
      <div className="gp">4</div><div className="gc"></div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">キャンパス植物図鑑演習</span><span className="nx">課題なし</span></div></div>
      <div className="gc"></div>
    </div>
    <div className="wire"></div>
    <div className="mail">
      <div className="mh"><span>7:30 ・ ToDoku</span><span>Gmail</span></div>
      <p className="ms">今日やること（11/10）</p>
      <p className="mi">16:20から：書き方を書くレポートの準備</p>
      <div className="mb"><span className="on">終わった</span><span>後回し</span></div>
    </div>
    </div>
  </section>

  <section className="sec" id="how" aria-labelledby="how-title">
    <div className="lab"><b>01</b>しくみ</div>
    <h2 className="sh" id="how-title">LMS を開くと、3つのことが起きます</h2>
    <div className="bar"></div>
    <div className="steps">
      <div className="step">
        <span className="sn">01</span><h3 className="st">いつもの LMS を開く</h3>
        <p className="sd">学生はログインするだけです。拡張機能が、裏で全部の授業の課題を見に行きます。</p>
        <a className="shot-link" href="/landing/lms.png"><img className="shot" src="/landing/lms.png" alt="体験用LMSに並ぶ架空の授業と課題" width="868" height="535" /></a>
      </div>
      <div className="step">
        <span className="sn">02</span><h3 className="st">前回と比べる</h3>
        <p className="sd">増えた課題と、延びた締切を記録します。変わったところは朱で示します。</p>
        <a className="shot-link" href="/landing/updated.png"><img className="shot" src="/landing/updated.png" alt="締切の変更後の学生画面の時間割" width="884" height="635" /></a>
      </div>
      <div className="step">
        <span className="sn">03</span><h3 className="st">いつもの場所に届く</h3>
        <p className="sd">時間割、Google カレンダー、朝の Gmail、面談画面に、同じ内容が出ます。</p>
      </div>
    </div>
  </section>

  <section className="sec" id="people" aria-labelledby="people-title">
    <div className="lab"><b>02</b>使う人</div>
    <h2 className="sh" id="people-title">学生と、学生を支える人のために</h2>
    <div className="bar"></div>
    <div className="two">
      <div className="who">
        <h3 className="st">学生</h3>
        <p className="sd">時間割の各コマに、次の締切が出ます。朝のメールの［終わった］か［後回し］を押せば、予定が動きます。</p>
        <a className="shot-link" href="/landing/student.png"><img className="shot" src="/landing/student.png" alt="架空の6つの授業が並ぶ学生画面の時間割" width="884" height="635" /></a>
      </div>
      <div className="who">
        <h3 className="st">支援担当（カウンセラーなど）</h3>
        <p className="sd">共有の許可がある学生の授業と課題が、面談画面に出ます。面談の前に、何が変わったかを確かめられます。</p>
        <a className="shot-link" href="/landing/session.png"><img className="shot" src="/landing/session.png" alt="田中太郎さんの架空の締切の変更と次回面談までの課題" width="1072" height="1005" /></a>
      </div>
    </div>
  </section>

  <section className="sec" id="try" aria-labelledby="try-title">
    <div className="lab"><b>03</b>体験する</div>
    <h2 className="sh" id="try-title">架空の大学で、そのまま試せます</h2>
    <div className="bar"></div>
    <div className="try">
      <LocalDemo />
      <SharedDemo />
    </div>
  </section>

  <section className="sec" id="start" aria-labelledby="start-title">
    <div className="lab"><b>04</b>使い始める</div>
    <h2 className="sh" id="start-title">新しく登録する手順はありません</h2>
    <div className="bar"></div>
    <div className="start">
      <div className="step">
        <span className="sn">01</span><h3 className="st">Chrome 拡張を入れる</h3>
        <p className="sd">今は開発版を手で入れます。手順は <a href={`${repository}#手元で動かす`}>GitHub</a> に書いています。</p>
      </div>
      <div className="step">
        <span className="sn">02</span><h3 className="st">Google でログインする</h3>
        <p className="sd">アカウントを作る手順はありません。Google のアカウントで、そのまま使い始めます。</p>
      </div>
      <div className="step">
        <span className="sn">03</span><h3 className="st">いつもの LMS を開く</h3>
        <p className="sd">今は横浜国立大学の LMS で動きます。ほかの LMS は、読み取り方の定義を足して広げます。</p>
      </div>
    </div>
  </section>

  <section className="sec" id="privacy" aria-labelledby="privacy-title">
    <div className="lab"><b>05</b>預からないもの</div>
    <h2 className="sh" id="privacy-title">大学のアカウントに手を触れません</h2>
    <div className="bar"></div>
    <div className="safe">
      <div className="sf">LMS のパスワードを預かりません</div>
      <div className="sf">LMS に提出や書き込みをしません</div>
      <div className="sf">メールは本人にだけ届きます</div>
      <div className="sf">支援担当が見られるのは、共有の許可がある学生だけです</div>
    </div>
  </section>

  </main>
  <footer className="foot"><span>ToDoku ・ TEAM ORANGE ・ DEVFEST GDGoC JAPAN HACKATHON 2026</span><a href={repository}>GitHub</a></footer>
  </div>;
}
