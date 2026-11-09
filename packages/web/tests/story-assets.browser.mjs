import assert from 'node:assert/strict';
import { URL } from 'node:url';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5262';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('local-preview-required');
const output = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-10-issue-262/assets';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const screenshots = [];
const observations = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.method()); });
  async function open(query = '') {
    await page.goto(`${origin}/slides/story-assets?${query}`);
    await page.locator('.story-sheet').waitFor();
    await page.evaluate(() => globalThis.document.fonts.ready);
  }
  await open();
  assert.equal(await page.getByRole('navigation', { name: '見本の種類' }).getByRole('button').count(), 4);
  await page.getByRole('button', { name: '場面の見本' }).click();
  assert.equal(await page.getByLabel('配色', { exact: true }).count(), 0);
  await page.getByLabel('場面', { exact: true }).selectOption('morning');
  assert.match(await page.locator('.story-sheet').textContent(), /水 07:30.*今日やること/);
  await page.reload();
  await page.locator('[data-palette="b"][data-scene="morning"]').waitFor();
  const preview = await page.locator('.story-preview').boundingBox();
  assert(Math.abs(preview.width / preview.height - 16 / 9) < .001);
  assert(preview.y + preview.height <= 720, 'controls and frame fit the viewport');
  await page.screenshot({ path: `${output}/page-controls.png` });
  screenshots.push('page-controls.png');
  observations.push({ operation: 'choose scene and palette, then reload', palette: 'b', scene: 'morning', aspectRatio: '16:9', controlsFit: true });

  const shots = [
    ['assets-b', 'view=assets'],
    ['screens', 'view=screens'], ['eyecatch', 'view=brand'],
    ...['office', 'bedroom', 'consultation', 'meeting', 'morning'].map(scene => [`scene-${scene}`, `view=scene&scene=${scene}`]),
  ];
  for (const [name, query] of shots) {
    await open(`capture=1&${query}`);
    const frame = await page.locator('.story-sheet').boundingBox();
    assert.deepEqual({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, { x: 0, y: 0, width: 1280, height: 720 });
    const measurements = await page.locator('.story-sheet').evaluate(sheet => {
      const outside = [...sheet.querySelectorAll('text')].filter(text => {
        const box = text.getBoundingClientRect();
        return box.left < -1 || box.right > 1281 || box.top < -1 || box.bottom > 721;
      }).map(text => text.textContent);
      const peopleClipped = [...sheet.querySelectorAll('[data-role]')].filter(person => {
        const box = person.getBBox(); const view = person.viewBox.baseVal;
        return box.x < view.x || box.y < view.y || box.x + box.width > view.x + view.width || box.y + box.height > view.y + view.height;
      }).map(person => `${person.dataset.role}/${person.dataset.pose}`);
      return { textOutside: outside, peopleClipped, animations: sheet.getAnimations({ subtree: true }).length,
        rasterImages: sheet.querySelectorAll('img, image, foreignObject').length };
    });
    assert.deepEqual(measurements.textOutside, [], `${name}: text fits`);
    assert.deepEqual(measurements.peopleClipped, [], `${name}: full silhouettes fit`);
    assert.equal(measurements.animations, 0, `${name}: static material preview`);
    assert.equal(measurements.rasterImages, 0, `${name}: inline SVG materials`);
    await page.screenshot({ path: `${output}/${name}.png` });
    screenshots.push(`${name}.png`);
    observations.push({ name, width: 1280, height: 720, ...measurements });
  }
  await open('capture=1&view=scene&scene=meeting');
  const motion = await page.locator('.story-sheet').innerHTML();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.story-sheet').innerHTML(), motion, 'reduced motion keeps the same static frame');
  assert.deepEqual(apiRequests, [], 'preview never calls product APIs');
  assert.deepEqual(errors, []);
  await page.goto(origin);
  assert.equal(await page.locator('a[href*="/slides/story-assets"]').count(), 0, 'no introduction link to the preview');
  await writeFile(`${output}/verification.json`, JSON.stringify({ screenshots, observations, reducedMotion: 'same static frame', apiRequests, pageErrors: errors }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'preview', status: 'pass',
    observed: { captures: screenshots.length, dimensions: '1280x720', scenes: 5, palettes: 1, noMotion: true, apiRequests: 0, controlsAndReload: true },
    evidence_files: [...screenshots, 'verification.json'] }] }));
} finally { await browser.close(); }
