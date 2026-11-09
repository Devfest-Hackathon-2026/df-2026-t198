// The selected reference combines cumulative lit lines (B) with a following camera (C).
export const stepDuration = 3000;
export const motionDuration = 2000;
export type NodeKey = 'T' | 'S' | 'H' | 'M' | 'P';
type Point = readonly [number, number];
export const routeKeys = ['r1', 'r2', 'r3', 'r4'] as const;
type RouteKey = typeof routeKeys[number];
export interface Layout { w: number; h: number; at: Record<NodeKey, Point>; routes: Record<RouteKey, string> }
export const layouts: Record<'wide' | 'compact', Layout> = {
  wide: { w: 712, h: 320,
    at: { T: [16, 124], S: [200, 124], H: [384, 124], M: [568, 30], P: [568, 218] },
    routes: { r1: 'M144 160H200', r2: 'M328 160H384', r3: 'M512 160H528Q540 160 540 148V78Q540 66 552 66H568', r4: 'M512 160H528Q540 160 540 172V242Q540 254 552 254H568' } },
  compact: { w: 336, h: 336,
    at: { T: [16, 12], S: [192, 12], H: [192, 124], M: [16, 124], P: [192, 236] },
    routes: { r1: 'M144 48H192', r2: 'M256 84V124', r3: 'M192 160H144', r4: 'M256 196V236' } },
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const progress = (t: number, start: number, end: number) => end <= start ? Number(t >= end) : clamp((t - start) / (end - start));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const ease = (p: number) => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
const bump = (p: number) => Math.sin(Math.PI * clamp(p));
const round = (value: number) => Math.round(value * 1000) / 1000;
type Camera = readonly [number, number, number];
const mix = (a: Camera, b: Camera, p: number): Camera => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
const focuses: readonly NodeKey[] = ['T', 'S', 'H', 'M', 'P', 'M'];
const routes: readonly (RouteKey | null)[] = [null, 'r1', 'r2', 'r3', 'r4', 'r3'];
const travel: readonly Point[] = [[0, 0], [1300, 1900], [1200, 1800], [600, 1500], [600, 1500], [800, 1700]];
const cameraTimes: readonly Point[] = [[600, 600], [1000, 2300], [900, 2200], [300, 2000], [300, 2000], [500, 2200]];

export function cameraAt(layout: Layout, step: number, t: number): Camera {
  const compact = layout === layouts.compact;
  const overview: Camera = [layout.w / 2, layout.h / 2, layout.w];
  const frame = (key: NodeKey): Camera => [layout.at[key][0] + 64, layout.at[key][1] + 36, compact ? 250 : 420];
  const destination = frame(focuses[step] ?? 'T');
  const source = frame(step === 1 ? 'T' : step === 2 ? 'S' : step >= 3 ? 'H' : 'T');
  const previous = step === 0 ? compact ? source : overview : step === 5 ? frame('P') : frame(focuses[step - 1] ?? 'T');
  const [start, end] = cameraTimes[step] ?? [0, 0];
  const p = ease(progress(t, start, end));
  let cam: Camera = t < 600 ? mix(previous, source, ease(t / 600)) : mix(source, destination, p);
  if (t >= 600) cam = [cam[0], cam[1], cam[2] + (compact ? 70 : 120) * bump(p)];
  if (step === 5 && !compact) cam = mix(cam, overview, ease(progress(t, 3600, 4800)));
  const [cx, cy, width] = cam;
  const height = width * layout.h / layout.w;
  return [Math.min(Math.max(cx, -100 + width / 2), layout.w + 100 - width / 2),
    Math.min(Math.max(cy, -100 + height / 2), layout.h + 100 - height / 2), width];
}

export function bindScene(svg: SVGSVGElement, layout: Layout) {
  const refs = new Map<string, SVGGraphicsElement>();
  svg.querySelectorAll<SVGGraphicsElement>('[data-k]').forEach(el => refs.set(el.dataset['k'] ?? '', el));
  const get = (key: string) => {
    const element = refs.get(key);
    if (!element) throw new Error(`Missing mechanism element: ${key}`);
    return element;
  };
  const lengths = new Map<string, number>();
  // Width attributes are animated; rebinding after resize must use their original geometry.
  const widths: Record<string, number> = { tMark: 74, sMark: 74, hMark: 74, pMark: 98, mMark: 48, mMailMark: 80 };
  for (const key of [...routeKeys, 'tStrike', 'hStrike', 'pStrike']) lengths.set(key, (get(key) as SVGPathElement).getTotalLength());
  const opacity = (key: string, value: number) => { get(key).style.opacity = String(round(clamp(value))); };
  const shift = (key: string, x: number, y: number) => get(key).setAttribute('transform', `translate(${round(x)} ${round(y)})`);
  const dash = (key: string, p: number) => {
    const element = get(key); const length = lengths.get(key) ?? 0;
    element.style.strokeDasharray = `${length} ${length}`;
    element.style.strokeDashoffset = String(round(length * (1 - clamp(p))));
    element.style.visibility = p > .002 ? 'visible' : 'hidden';
  };
  const mark = (key: string, p: number) => get(key).setAttribute('width', String(round((widths[key] ?? 0) * clamp(p))));
  return (step: number, elapsed: number) => {
    // Keep the reference's relative timings; the entire motion finishes within two seconds.
    const t = elapsed * 5000 / motionDuration;
    const E = (s: number, a: number, b: number) => step > s ? 1 : step < s ? 0 : progress(t, a, b);
    const value = (prefix: string, s: number, offset: number) => {
      const moved = ease(E(s, offset, offset + 500));
      get(`${prefix}Old`).setAttribute('transform', `translate(${round(12 + 74 * moved)} 59) scale(${round(1 - .5 * moved)}) translate(-12 -59)`);
      opacity(`${prefix}Old`, 1 - .45 * moved);
      dash(`${prefix}Strike`, easeOut(E(s, offset + 400, offset + 700)));
      const shown = easeOut(E(s, offset + 200, offset + 700));
      opacity(`${prefix}New`, shown); shift(`${prefix}New`, 0, (1 - shown) * 8);
      mark(`${prefix}Mark`, easeOut(E(s, offset + 600, offset + 1000)));
    };
    value('t', 0, 900); value('h', 2, 2000);
    opacity('sOpen', 1 - E(1, 700, 950));
    opacity('sExt', easeOut(E(1, 800, 1200)));
    const sNew = easeOut(E(1, 2000, 2400));
    opacity('sNew', sNew); shift('sNew', 0, (1 - sNew) * 8); mark('sMark', easeOut(E(1, 2300, 2700)));
    const ghost = E(3, 1700, 2000); const placed = E(3, 2000, 2400);
    opacity('mGhost', ghost); shift('mChip', placed > 0 ? 58 : 0, 0);
    opacity('mChip', placed > 0 ? easeOut(placed) : 1 - ghost); mark('mMark', easeOut(E(3, 2300, 2700)));
    dash('pStrike', easeOut(E(4, 1600, 1900)));
    const gone = E(4, 2000, 2300); opacity('pStrike', 1 - gone); opacity('pBefore', 1 - gone);
    const after = easeOut(E(4, 2100, 2500)); opacity('pAfter', after); shift('pAfter', 0, (1 - after) * 8);
    mark('pMark', easeOut(E(4, 2400, 2800)));
    opacity('mTime', step === 5 ? easeOut(progress(t, 0, 500)) : 0);
    opacity('mCal', 1 - easeOut(E(5, 1900, 2300)));
    const mail = easeOut(E(5, 2000, 2500)); opacity('mMail', mail); shift('mMail', 0, (1 - mail) * 6);
    mark('mMailMark', easeOut(E(5, 2400, 2800)));
    for (const key of ['T', 'S', 'H', 'M', 'P']) {
      const start = step === 0 ? 0 : (travel[step]?.[1] ?? 0) + 100;
      opacity(`ring${key}`, focuses[step] === key ? easeOut(progress(t, start, start + 400)) : 0);
    }
    const active = routes[step]; const [start, end] = travel[step] ?? [0, 0];
    const drawn = ease(progress(t, start, end));
    routeKeys.forEach((key, index) => {
      const amount = step > index + 1 ? 1 : active === key ? drawn : 0;
      dash(key, amount); opacity(key, amount > 0 ? 1 : 0);
    });
    if (active) {
      const path = get(active) as SVGPathElement; const length = lengths.get(active) ?? 0;
      const point = path.getPointAtLength(length * drawn);
      shift('pulse', point.x, point.y); opacity('pulse', t >= start && t < end ? 1 : 0);
      const arrival = progress(t, end, end + 400); const at = path.getPointAtLength(length);
      get('ripple').setAttribute('cx', String(at.x)); get('ripple').setAttribute('cy', String(at.y));
      get('ripple').setAttribute('r', String(6 + 20 * easeOut(arrival)));
      opacity('ripple', arrival > 0 && arrival < 1 ? 1 - arrival : 0);
    } else { opacity('pulse', 0); opacity('ripple', 0); }
    if (step < 2) {
      const at = layout.at[step === 0 ? 'T' : 'S']; const click = step === 0 ? 750 : 650;
      const p = ease(progress(t, 150, click));
      shift('cursor', at[0] + lerp(110, 42, p), at[1] + lerp(66, 52, p));
      opacity('cursor', Math.min(progress(t, 0, 300), 1 - progress(t, 1200, 1600)));
      const ring = progress(t, click, click + 450);
      get('clickRing').setAttribute('r', String(4 + 13 * easeOut(ring))); opacity('clickRing', ring > 0 && ring < 1 ? 1 - ring : 0);
    } else opacity('cursor', 0);
    const [cx, cy, width] = cameraAt(layout, step, t); const height = width * layout.h / layout.w;
    svg.setAttribute('viewBox', [cx - width / 2, cy - height / 2, width, height].map(round).join(' '));
  };
}
