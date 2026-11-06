import { watchCollectionStatus } from './collection-display.js';
import { studentPageUrl } from './student-page.js';

const button = document.querySelector<HTMLButtonElement>('#open-student')!;
const url = studentPageUrl();
button.disabled = !url;
if (!url) button.title = '拡張機能のFirebase設定が必要です。';
button.addEventListener('click', () => {
  if (url) void chrome.tabs.create({ url }).catch(() => {});
});

const status = document.querySelector<HTMLElement>('#collection-status')!;
watchCollectionStatus(title => {
  status.textContent = title;
  status.hidden = !title;
});
