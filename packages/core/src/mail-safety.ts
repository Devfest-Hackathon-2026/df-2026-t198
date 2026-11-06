/** Shared mail check; the extension also supplies its current credential values. */
export function isSafeMailText(value: string, forbiddenValues: readonly string[] = []): boolean {
  let decoded = value;
  for (let i = 0; i < 5; i++) {
    if (forbiddenValues.some(secret => secret && decoded.includes(secret)) ||
      /\b(?:sid|jsessionid|session[_-]?id|cookie|authorization|(?:access|refresh|id)[_-]?token)\s*[:=]|\bbearer\s+\S+|https?:\/\/[^\s/<>"']+@/i.test(decoded)) return false;
    const next = decoded.replace(/&amp;/gi, '&').replace(/&(?:colon|equals);/gi, entity => entity.toLowerCase() === '&colon;' ? ':' : '=')
      .replace(/&#(x[\da-f]+|\d+);?/gi, (_all, code: string) => {
        const point = code[0]!.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return point <= 0x10ffff ? String.fromCodePoint(point) : '';
      }).replace(/(?:%[\da-f]{2})+/gi, part => { try { return decodeURIComponent(part); } catch { return part; } });
    if (next === decoded) return true;
    decoded = next;
  }
  return false;
}
