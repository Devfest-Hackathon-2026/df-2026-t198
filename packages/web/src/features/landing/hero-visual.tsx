const days = ['月', '火', '水', '木', '金'];
// One fictional week: [period, weekday, course colour, name, note].
const cells: [number, number, number, string, string][] = [
  [1, 2, 6, '線形代数', '11/20'], [1, 3, 0, '社会調査法', '11/21'],
  [2, 1, 4, '文章表現', '11/14'], [2, 5, 1, '統計学入門', ''],
  [3, 3, 7, '経済学入門', ''], [4, 4, 5, '生物学実験', ''],
];

/** The two windows are miniature app screens, so they take the app theme (`.app`) for course colours.
 * The same fictional assignment appears on the student's timetable and on the supporter's list. */
export function HeroVisual() {
  return <div className="hero-visual" role="img" aria-label="学生の時間割と支援担当の面談画面に、同じ課題と締切が出ている図">
    <div className="visual-canvas">
      <div className="app hv-window hv-supporter">
        <div className="hv-bar"><span>支援担当の画面</span><i>面談</i></div>
        <p className="hv-name">田中 太郎<small>次の面談 11/17（火）</small></p>
        <div className="hv-row is-shared"><b data-course-color="4">文章表現</b><span>第3回レポート（要約と引用）</span><time>11/14 17:00</time><em>あと4日</em></div>
        <div className="hv-row"><b data-course-color="6">線形代数</b><span>第5回 小テスト</span><time>11/20 17:00</time><em>あと10日</em></div>
      </div>
      <svg className="hv-link" viewBox="0 0 640 500" aria-hidden="true">
        <path d="M96 322V124Q96 108 112 108H232" /><circle cx="96" cy="322" r="5" /><circle cx="232" cy="108" r="5" />
      </svg>
      <div className="app hv-window hv-student">
        <div className="hv-bar"><span>学生の画面</span><i>時間割と課題</i></div>
        <div className="hv-grid">
          <span />{days.map(day => <span className="hv-day" key={day}>{day}</span>)}
          {[1, 2, 3, 4].flatMap(period => [<span className="hv-period" key={`p${period}`}>{period}</span>,
            ...days.map((day, index) => {
              const cell = cells.find(item => item[0] === period && item[1] === index + 1);
              return <span className="hv-slot" key={`${period}${day}`}>{cell &&
                <span className={`hv-course${cell[3] === '文章表現' ? ' is-shared' : ''}`} data-course-color={cell[2]}><b>{cell[3]}</b>{cell[4] && <time>{cell[4]}</time>}</span>}</span>;
            })])}
        </div>
      </div>
      <div className="hv-mail">
        <span className="hv-mail-time">7:30</span>
        <p><b>今日やること</b><span>16:20から：第3回レポートの準備</span></p>
      </div>
    </div>
  </div>;
}
