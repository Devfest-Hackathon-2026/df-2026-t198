import { SessionPage } from './session-page';

export function App() {
  const path = window.location.pathname;
  const title = path === '/student' || path === '/'
    ? '時間割と課題'
    : path === '/session'
      ? '面談'
      : 'ページが見つかりません';

  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="/student">課題の秘書</a>
        <nav aria-label="画面">
          <a href="/student" aria-current={path === '/student' || path === '/' ? 'page' : undefined}>学生</a>
          <a href="/session" aria-current={path === '/session' ? 'page' : undefined}>面談</a>
        </nav>
      </header>
      <main>
        <h1>{title}</h1>
        {path === '/session' && <div className="session-page"><SessionPage /></div>}
      </main>
    </div>
  );
}
