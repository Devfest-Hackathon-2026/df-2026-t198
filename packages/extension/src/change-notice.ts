import { studentPageUrl } from './student-page.js';

let notice: HTMLElement | undefined;

export function showChangeNotice(response: unknown): void {
  notice?.remove();
  notice = undefined;
  const url = studentPageUrl();
  if (!url || !response || typeof response !== 'object') return;
  const result = response as { ok?: unknown; changed?: unknown; changeCount?: unknown };
  if (result.ok !== true || result.changed !== true || typeof result.changeCount !== 'number'
    || !Number.isSafeInteger(result.changeCount) || result.changeCount <= 0) return;

  notice = document.createElement('div');
  // Keep LMS styles and layout separate; only the link receives pointer events.
  notice.style.cssText = 'all: initial !important; position: fixed !important; right: 12px !important; bottom: 12px !important; z-index: 2147483647 !important; display: block !important; max-width: calc(100vw - 24px) !important; pointer-events: none !important;';
  const shadow = notice.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `a { all: initial; display: block; box-sizing: border-box; max-width: calc(100vw - 24px);
    padding: 10px 14px; border: 1px solid #b4c7bd; border-radius: 8px; background: #f4faf6;
    color: #193c2c; font: 14px/1.5 system-ui, sans-serif; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; cursor: pointer; pointer-events: auto;
    box-shadow: 0 2px 8px #0002; }
    a:hover { text-decoration: underline; } a:focus-visible { outline: 2px solid #256b4b; outline-offset: 2px; }`;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `課題の変更が${result.changeCount}件あります。学生の画面を開く`;
  shadow.append(style, link);
  document.body.append(notice);
}
