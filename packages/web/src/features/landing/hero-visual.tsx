export function HeroVisual() {
  return <div className="hero-visual" role="img" aria-label="時間割の課題から、Gmailの今日やることへ">
    <div className="visual-canvas"><div className="grid">
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
    </div></div>;
}
