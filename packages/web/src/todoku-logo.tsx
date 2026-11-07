import './todoku-logo.css';

export function TodokuLogo() {
  return <span className="todoku-logo">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M22.7 4v56M41.3 4v56M4 32h56" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="24.2" y="5.5" width="15.6" height="25" fill="#D9402B" />
    </svg>
    <span>ToDo<span className="todoku-ku">ku</span></span>
  </span>;
}
