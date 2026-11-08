import type { DemoData } from '@kadai-hisho/core';
import { useEffect, useState } from 'react';
import { ChangedDeadline } from '../../shared/assignments/deadline-change';

export function demoDueText(iso: string) {
  const date = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '/')} (${'日月火水木金土'[date.getUTCDay()]}) ${date.toISOString().slice(11, 16)} まで`;
}
const statusText = (status: string) => status === 'submitted' ? '提出済み' : status === 'not-submitted' ? '受付中' : '確認中';

export function DemoPages({ data }: { data: DemoData }) {
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
    <div className="demo-campus">学習ポータル <span>体験大学</span></div>
    <div className="demo-lms-layout"><nav className="demo-course-nav" aria-label="LMSの授業">
      <a href="#courses">授業一覧</a>
      {data.courses.map(course => <a key={course.courseId} href={`#materials-${course.courseId}`}
        aria-current={selected === course ? 'page' : undefined}>{course.name}</a>)}
    </nav><div className="demo-lms-content">
    <nav className="demo-breadcrumb" aria-label="LMSの現在地"><a href="#courses">授業一覧</a>
      {selected && <> / <a href={`#materials-${selected.courseId}`}>{selected.name}</a></>}
      {detail && <> / <span>{detail.title}</span></>}</nav>
    <section data-demo-page="home" hidden={!!selected} aria-label="体験用LMSの授業一覧">
      <h2>授業一覧</h2>
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
        {course.assignments.length ? <ul>{course.assignments.map(task => <li className="demo-task" key={task.sourceId}>
          <a id={task.sourceId} href={`#detail-${task.sourceId}`}>{task.title}</a>
          <span className="demo-status">{statusText(task.submission)}</span><span className="demo-availability">公開中</span>
        </li>)}</ul> : <p className="demo-empty">課題はありません</p>}
        <p className="demo-list-end">課題はここまでです</p>
      </section>
      {course.assignments.map(task => <article id={`detail-${task.sourceId}`} key={task.sourceId}
        hidden={detail !== task}
        data-demo-page="detail" data-source-id={task.sourceId} aria-label={`${task.title}の詳細`}>
        <h1>{task.title}</h1><dl><dt>締切</dt><dd><span className="demo-due" hidden>{demoDueText(task.dueAt)}</span>
          <ChangedDeadline value={demoDueText(task.dueAt)} /></dd>
          <dt>提出の状態</dt><dd className="demo-status">{statusText(task.submission)}</dd></dl>
      </article>)}
    </div>)}
  </div></div></div>;
}
