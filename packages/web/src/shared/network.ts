// All product API calls pass here; only a count is retained, never request data.
let pending = 0;
const listeners = new Set<() => void>();
export const pendingRequests = () => pending;
export function subscribeRequests(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function serverFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  pending++; listeners.forEach(listener => listener());
  try { return await fetch(input, init); }
  finally { pending--; listeners.forEach(listener => listener()); }
}
