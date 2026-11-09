import type { DemoData } from '@kadai-hisho/core';
import { useEffect, useState } from 'react';
import './lms.css';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';

export function demoDueText(iso: string) {
  const date = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '/')} (${'日月火水木金土'[date.getUTCDay()]}) ${date.toISOString().slice(11, 16)} まで`;
}
const statusText = (status: string) => status === 'submitted' ? '提出済み' : status === 'not-submitted' ? '受付中' : '確認中';

export function DemoPages({ data }: { data: DemoData }) {
  const [firstDue, setFirstDue] = useState<Record<string, string>>({});
  useEffect(() => {
    setFirstDue(previous => Object.fromEntries(data.courses.flatMap(course => course.assignments).map(task =>
      [task.sourceId, previous[task.sourceId] && previous[task.sourceId]! < task.dueAt ? previous[task.sourceId]! : task.dueAt])));
  }, [data]);
  const [hash, setHash] = useState(() => typeof window === 'undefined' ? '' : window.location.hash);
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const selected = data.courses.find(course => hash === `#materials-${course.courseId}` ||
    course.assignments.some(task => hash === `#detail-${task.sourceId}`));
  const detail = selected?.assignments.find(task => hash === `#detail-${task.sourceId}`);
  return <div className="demo-pages lms-skin">
    <div className="demo-campus"><span className="rd-lms-crest" aria-hidden="true">体</span><div>学習ポータル <span>体験大学 授業支援システム</span></div><span className="rd-lms-user">ログイン中：体験 学生 さん</span></div>
    <div className="rd-lms-year"><span>授業</span><span>{new Date().getFullYear()}年度 後期</span><span>体験用の架空のLMSです</span></div>
    <div className="demo-lms-layout"><nav className="demo-course-nav" aria-label="LMSの授業">
      <div className="rd-lms-nav-title">授業メニュー</div><a href="#courses" aria-current={!selected ? 'page' : undefined}>授業一覧</a>
      {data.courses.map(course => <a key={course.courseId} href={`#materials-${course.courseId}`}
        aria-current={selected === course ? 'page' : undefined}>{course.name}</a>)}
    </nav><div className="demo-lms-content">
    <nav className="demo-breadcrumb" aria-label="LMSの現在地">現在地：<a href="#courses">授業一覧</a>
      {selected && <> / <a href={`#materials-${selected.courseId}`}>{selected.name}</a></>}
      {detail && <> / <span>{detail.title}</span></>}</nav>
    <section data-demo-page="home" hidden={!!selected} aria-label="体験用LMSの授業一覧">
      <h2>授業一覧</h2>
      <div className="rd-lms-columns" aria-hidden="true"><span>授業名</span><span>担当教員</span><span>曜日・時限</span><span>課題</span></div>
      {data.courses.map(course => <section className="demo-course" key={course.courseId}>
        <h2>{course.name}</h2><p className="demo-teacher">{course.teacher}</p>
        <p><span className="demo-day">{'月火水木金土日'[course.weekday - 1]}</span>曜
          <span className="demo-period">{course.period}</span>限</p>
        <a id={course.courseId} href={`#materials-${course.courseId}`}>課題一覧へ</a>
      </section>)}
    </section>
    <section className="demo-announcements" aria-label="授業のお知らせ" hidden={!data.announcements?.length}><h2>お知らせ</h2>
      {(data.announcements ?? []).map(({ courseId, announcement }) =>
        <article key={announcement.announcementId} data-demo-announcement data-course-id={courseId}
          data-announcement-id={announcement.announcementId} data-version={announcement.version} data-published-at={announcement.publishedAt}>
          <h3>{data.courses.find(course => course.courseId === courseId)?.name}</h3>
          <p>{data.courses.find(course => course.courseId === courseId)?.teacher}（先生役）</p>
          <time dateTime={announcement.publishedAt}>{demoDueText(announcement.publishedAt).replace(' まで', '')}</time>
          <p className="demo-announcement-body">{announcement.body}</p>
        </article>)}
    </section>
    {data.courses.map(course => <div key={course.courseId}>
      <section id={`materials-${course.courseId}`} data-demo-page="materials" data-course-id={course.courseId}
        hidden={selected !== course || !!detail}
        aria-label={`${course.name}の教材一覧`}>
        <h2>{course.name}の課題</h2>
        <div className="rd-lms-task-columns" aria-hidden="true"><span>課題名</span><span>提出の状態</span></div>
        {course.assignments.length ? <ul>{course.assignments.map(task => <li className="demo-task" key={task.sourceId}>
          <a id={task.sourceId} href={`#detail-${task.sourceId}`}>{task.title}</a>
          <span className="demo-status">{statusText(task.submission)}</span><span className="demo-availability">公開中</span>
        </li>)}</ul> : <p className="demo-empty">課題はありません</p>}
        <p className="demo-list-end">課題はここまでです</p>
      </section>
      {course.assignments.map(task => <article id={`detail-${task.sourceId}`} key={task.sourceId}
        hidden={detail !== task}
        data-demo-page="detail" data-source-id={task.sourceId} aria-label={`${task.title}の詳細`}>
        <h1>{task.title}</h1>
        {firstDue[task.sourceId] && task.dueAt > firstDue[task.sourceId]! && <p className="rd-lms-notice">担当教員からの変更：提出の締切を延長しました。</p>}
        <dl><dt>授業</dt><dd>{course.name}（{course.teacher}） {'月火水木金土日'[course.weekday - 1]}曜{course.period}限</dd><dt>締切</dt><dd><span className="demo-due" hidden>{demoDueText(task.dueAt)}</span>
          <ChangedDeadline value={demoDueText(task.dueAt)}
            previous={firstDue[task.sourceId] && task.dueAt > firstDue[task.sourceId]! ? demoDueText(firstDue[task.sourceId]!) : undefined}
            highlight={!!firstDue[task.sourceId] && task.dueAt > firstDue[task.sourceId]!} /></dd>
          <dt>提出の状態</dt><dd className="demo-status">{statusText(task.submission)}</dd></dl>
      </article>)}
    </div>)}
  </div></div><footer className="rd-lms-footer">体験大学 学習ポータル（ToDoku の体験用に作った架空の画面です）</footer></div>;
}
