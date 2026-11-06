/** Shared by digest composition and the extension's final mail check. */
export function isSafeMailText(value: string): boolean {
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (/\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+/i.test(decoded)) return false;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return true;
      decoded = next;
    } catch { return true; }
  }
  return false;
}
