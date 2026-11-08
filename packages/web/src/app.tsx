import { lazy, Suspense } from 'react';
import { NetworkProgress } from './shared/ui/loading';
import { LandingPage } from './features/landing/page';
import { TodokuLogo } from './shared/ui/todoku-logo';
import { StudentPage } from './features/student/page';
import { SessionPage } from './features/session/page';
import { usePathname } from './shared/use-pathname';
import { DemoPage } from './features/demo/page';

const UiGallery = import.meta.env.DEV ? lazy(() => import('./shared/ui/gallery')) : null;

export function App() {
  const path = usePathname();
  return <><NetworkProgress /><Route path={path} /></>;
}
function Route({ path }: { path: string }) {
  if (path === '/dev/ui' && UiGallery) return <Suspense fallback={<p role="status">見本を開いています…</p>}><UiGallery /></Suspense>;
  if (path === '/') return <LandingPage />;
  const session = path === '/session' || /^\/session\/[^/]+(?:\/plan)?\/?$/.test(path);
  const title = path === '/student' || path === '/student/plan'
    ? '時間割と課題'
    : session
      ? '面談'
      : 'ページが見つかりません';

  return (
    <div className="app app-shell">
      <header className="app-header">
        <a className="app-home" href="/student"><TodokuLogo /></a>
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
