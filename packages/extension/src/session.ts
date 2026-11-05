export interface SessionFound {
  type: 'ynu-session-found';
  sid: string;
}

export function sessionFromUrl(url: string): string | null {
  try {
    const page = new URL(url);
    if (page.origin !== 'https://lms.ynu.ac.jp') return null;
    return page.pathname.match(/;SID=([^/;]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isSessionFound(message: unknown): message is SessionFound {
  return typeof message === 'object' && message !== null
    && 'type' in message && message.type === 'ynu-session-found'
    && 'sid' in message && typeof message.sid === 'string' && message.sid.length > 0;
}
