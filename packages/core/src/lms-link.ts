import { isSafeMailText } from './mail-safety.js';

type ParseUrl = (value: string, base?: string) => {
  href: string; origin: string; protocol: string; username: string; password: string; hash: string;
  searchParams: { keys(): Iterable<string> };
};

function safeLmsUrl(value: string, parseUrl: ParseUrl) {
  if (!isSafeMailText(value)) return false;
  try {
    const url = parseUrl(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash &&
      ![...url.searchParams.keys()].some(key => /sid|session|cookie|token|auth|password|secret|api[_-]?key/i.test(key));
  } catch { return false; }
}

// Navigation is data supplied by the caller; no LMS-specific behavior lives here.
export function assignmentLmsLink(url: string, courseName: string, title: string,
  navigation: { statefulSession: boolean; home: string } | undefined, parseUrl: ParseUrl) {
  if (!safeLmsUrl(url, parseUrl) || !isSafeMailText(courseName) || !isSafeMailText(title)) return null;
  if (!navigation?.statefulSession) return { url, route: null };
  try {
    const home = parseUrl(navigation.home, url);
    if (home.origin !== parseUrl(url).origin || !safeLmsUrl(home.href, parseUrl)) return null;
    return { url: home.href, route: `ホーム › ${courseName} › ${title}` };
  } catch { return null; }
}
