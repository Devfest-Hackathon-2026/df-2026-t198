/** Remove YNU path session parameters without rewriting the rest of the URL. */
export function stripSessionId(url: string): string {
  const suffixStart = url.search(/[?#]/);
  const path = suffixStart === -1 ? url : url.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? '' : url.slice(suffixStart);
  return path.replace(/;SID=[^/;]*/gi, '') + suffix;
}
