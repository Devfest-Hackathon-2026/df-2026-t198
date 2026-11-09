import process from 'node:process';
import { mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from 'node:console';

// Start web dev/preview first, then set KADAI_WEB_ORIGIN if it is not on port 5173.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5173';
const directory = await mkdtemp(join(tmpdir(), 'todoku-mechanism-'));
const size = { width: 1280, height: 720 };
const browser = await chromium.launch({ headless: true });
let video;
try {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: directory, size }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  video = page.video();
  await page.mouse.move(0, 0);
  await page.goto(`${base}/slides/mechanism?autoplay=1`);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.getAttribute('data-finished') === 'true', null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await context.close();
} finally { await browser.close(); }
if (!video) throw new Error('録画が作成されませんでした');
const webm = join(directory, 'mechanism.webm');
await rename(await video.path(), webm);
const mp4 = join(directory, 'mechanism.mp4');
const conversion = spawnSync('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
if (conversion.error && conversion.error.code !== 'ENOENT') throw conversion.error;
if (!conversion.error && conversion.status !== 0) throw new Error(`ffmpeg conversion failed: ${conversion.status}`);
const files = { webm, ...(conversion.status === 0 ? { mp4 } : {}) };
await writeFile(join(directory, 'recording.json'), JSON.stringify({ viewport: size, stages: 6, secondsPerStage: 5, files }, null, 2));
log(JSON.stringify(files));
