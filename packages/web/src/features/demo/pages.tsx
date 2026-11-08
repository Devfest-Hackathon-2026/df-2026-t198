import type { DemoData } from '@kadai-hisho/core';

export function demoDueText(iso: string) {
  const date = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${date.toISOString().slice(0, 10).replaceAll('-', '/')} (${'日月火水木金土'[date.getUTCDay()]}) ${date.toISOString().slice(11, 16)} まで`;
}
const statusText = (status: string) => status === 'submitted' ? '提出済み' : status === 'not-submitted' ? '受付中' : '確認中';

export function DemoPages({ data }: { data: DemoData }) {
  return <div className="demo-pages">
    <section data-demo-page="home" aria-label="体験用LMSの授業一覧">
      <h2>授業一覧</h2>
      {data.courses.map(course => <section className="demo-course" key={course.courseId}>
        <h2>{course.name}</h2><p className="demo-teacher">{course.teacher}</p>
        <p><span className="demo-day">{'月火水木金土日'[course.weekday - 1]}</span>曜
          <span className="demo-period">{course.period}</span>限</p>
        <a id={course.courseId} href={`#materials-${course.courseId}`}>課題一覧へ</a>
      </section>)}
    </section>
    <section aria-label="授業のお知らせ"><h2>お知らせ</h2>
      {(data.announcements ?? []).map(({ courseId, announcement }) =>
        <article key={announcement.announcementId} data-demo-announcement data-course-id={courseId}
          data-announcement-id={announcement.announcementId} data-version={announcement.version} data-published-at={announcement.publishedAt}>
          <h3>{data.courses.find(course => course.courseId === courseId)?.name}</h3>
          <time dateTime={announcement.publishedAt}>{demoDueText(announcement.publishedAt).replace(' まで', '')}</time>
          <p className="demo-announcement-body">{announcement.body}</p>
        </article>)}
    </section>
    {data.courses.map(course => <div key={course.courseId}>
      <section id={`materials-${course.courseId}`} data-demo-page="materials" data-course-id={course.courseId}
        aria-label={`${course.name}の教材一覧`}>
        <h2>{course.name}の課題</h2>
        {course.assignments.length ? <ul>{course.assignments.map(task => <li className="demo-task" key={task.sourceId}>
          <a id={task.sourceId} href={`#detail-${task.sourceId}`}>{task.title}</a>
          <span className="demo-status">{statusText(task.submission)}</span><span className="demo-availability">公開中</span>
        </li>)}</ul> : <p className="demo-empty">課題はありません</p>}
        <p className="demo-list-end">課題はここまでです</p>
      </section>
      {course.assignments.map(task => <article id={`detail-${task.sourceId}`} key={task.sourceId}
        data-demo-page="detail" data-source-id={task.sourceId} aria-label={`${task.title}の詳細`}>
        <h1>{task.title}</h1><dl><dt>締切</dt><dd className="demo-due">{demoDueText(task.dueAt)}</dd>
          <dt>提出の状態</dt><dd className="demo-status">{statusText(task.submission)}</dd></dl>
      </article>)}
    </div>)}
  </div>;
}
