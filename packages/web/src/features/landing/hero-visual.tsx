export function HeroVisual() {
  return <div className="hero-visual" role="img" aria-label="時間割の課題から、Gmailの今日やることへ">
    <div className="visual-canvas"><div className="grid">
      <div className="gh"></div><div className="gh">月</div><div className="gh">火</div><div className="gh">水</div><div className="gh">木</div><div className="gh">金</div>
      <div className="gp">1</div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">線形代数</span><span className="nx">締切 11/18</span></div></div>
      <div className="gc"><div className="cell"><span className="cn">社会調査法</span><span className="nx">締切 11/19</span></div></div>
      <div className="gc"></div><div className="gc"></div>
      <div className="gp">2</div>
      <div className="gc"><div className="cell hot"><span className="cn">文章表現</span><span className="nx">締切 11/11</span></div></div>
      <div className="gc"></div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">統計学入門</span><span className="nx">課題なし</span></div></div>
      <div className="gp">3</div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">経済学入門</span><span className="nx">提出済み</span></div></div>
      <div className="gc"></div><div className="gc"></div>
      <div className="gp">4</div><div className="gc"></div><div className="gc"></div><div className="gc"></div>
      <div className="gc"><div className="cell"><span className="cn">生物学実験</span><span className="nx">課題なし</span></div></div>
      <div className="gc"></div>
    </div>
    <div className="wire"></div>
    <div className="mail">
      <div className="mh"><span>7:30 ・ ToDoku</span><span>Gmail</span></div>
      <p className="ms">今日やること（11/10）</p>
      <p className="mi">16:20から：第3回レポート（要約と引用）の準備</p>
      <div className="mb"><span className="on">終わった</span><span>後回し</span></div>
    </div>
    </div></div>;
}
