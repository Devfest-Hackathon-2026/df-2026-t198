import { LandingPage } from './landing';
import { TodokuLogo } from './todoku-logo';
import { StudentPage } from './student';
import { SessionPage } from './session-page';
import { usePathname } from './session-route';
import { DemoPage } from './demo-page';

export function App() {
  const path = usePathname();
  if (path === '/') return <LandingPage />;
  const session = path === '/session' || /^\/session\/[^/]+(?:\/plan)?\/?$/.test(path);
  const title = path === '/student' || path === '/student/plan'
    ? '時間割と課題'
    : session
      ? '面談'
      : 'ページが見つかりません';

  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="/student"><TodokuLogo /></a>
        <nav aria-label="画面">
          <a href="/demo-lms" aria-current={path === '/demo-lms' ? 'page' : undefined}>体験用LMS</a>
          <a href="/student" aria-current={path === '/student' || path === '/student/plan' ? 'page' : undefined}>学生</a>
          <a href="/session" aria-current={session ? 'page' : undefined}>面談</a>
        </nav>
      </header>
      <main>
        {path === '/student' || path === '/student/plan' ? <StudentPage /> : path === '/demo-lms' ? <DemoPage /> : !session && <h1>{title}</h1>}
        {session && <div className="session-page"><SessionPage path={path} /></div>}
      </main>
    </div>
  );
}
