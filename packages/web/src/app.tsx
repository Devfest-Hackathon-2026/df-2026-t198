import { lazy, Suspense } from 'react';
import { NetworkProgress } from './shared/ui/loading';
import { LandingPage } from './features/landing/page';
import { AppHome } from './shared/auth/app-home';
import { StudentPage } from './features/student/page';
import { SessionPage } from './features/session/page';
import { usePathname } from './shared/use-pathname';
import { DemoPage } from './features/demo/page';
import { MechanismSlides } from './features/landing/mechanism';
import { useSessionAccess } from './shared/auth/session-access';

const UiGallery = import.meta.env.DEV ? lazy(() => import('./shared/ui/gallery')) : null;
const StorySlides = lazy(() => import('./features/landing/story/player'));
const StoryAssetsPage = lazy(() => import('./features/landing/story/page'));

export function App() {
  const path = usePathname();
  return <><NetworkProgress /><Route path={path} /></>;
}
function Route({ path }: { path: string }) {
  if (path === '/slides/story') return <Suspense fallback={<p role="status">映像を開いています…</p>}><StorySlides /></Suspense>;
  if (path === '/slides/story-assets') return <Suspense fallback={<p role="status">見本を開いています…</p>}><StoryAssetsPage /></Suspense>;
  if (path === '/slides/mechanism') return <MechanismSlides />;
  if (path === '/dev/ui' && UiGallery) return <Suspense fallback={<p role="status">見本を開いています…</p>}><UiGallery /></Suspense>;
  if (path === '/') return <LandingPage />;
  return <AppShell path={path} />;
}
function AppShell({ path }: { path: string }) {
  const access = useSessionAccess();
  const session = path === '/session' || /^\/session\/[^/]+(?:\/plan)?\/?$/.test(path);
  const title = path === '/student' || path === '/student/plan'
    ? '時間割と課題'
    : session
      ? '面談'
      : 'ページが見つかりません';

  return (
    <div className="app app-shell">
      <header className="app-header">
        <div className="rd-bar-in"><AppHome />
        <nav aria-label="画面">
          <a href="/demo-lms" aria-current={path === '/demo-lms' ? 'page' : undefined}>体験用LMS</a>
          <a href="/student" aria-current={path === '/student' || path === '/student/plan' ? 'page' : undefined}>学生</a>
          {(session || access.visible) && <a href="/session" aria-current={session ? 'page' : undefined}>面談</a>}
        </nav><div id="rd-account-actions" className="rd-account-actions" /></div>
      </header>
      <main>
        {path === '/student' || path === '/student/plan' ? <StudentPage showOwnSession={access.own} /> : path === '/demo-lms' ? <DemoPage /> : !session && <h1>{title}</h1>}
        {session && <div className="session-page"><SessionPage path={path} /></div>}
      </main>
      <a className="app-introduction" href="/">ToDokuの紹介ページ</a>
    </div>
  );
}
