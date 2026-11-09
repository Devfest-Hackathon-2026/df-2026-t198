import process from 'node:process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from 'node:console';

// Start web dev/preview first, then set KADAI_WEB_ORIGIN if it is not on port 5173.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5173';
const directory = resolve('out/mechanism-simple');
const temporary = await mkdtemp(join(tmpdir(), 'todoku-mechanism-'));
const size = { width: 1280, height: 720 };
const browser = await chromium.launch({ headless: true });
let video;
try {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: temporary, size }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${base}/slides/mechanism`);
  await page.evaluate(() => globalThis.document.fonts.ready);
  // Warm the fonts and script before recording a complete automatic loop.
  await page.close();
  const recording = await context.newPage();
  video = recording.video();
  await recording.mouse.move(0, 0);
  await recording.goto(`${base}/slides/mechanism?autoplay=1`);
  await recording.waitForFunction(() => Number(globalThis.document.querySelector('.mechanism')?.getAttribute('data-cycle')) >= 1, null, { timeout: 25000 });
  await context.close();
} finally { await browser.close(); }
if (!video) throw new Error('録画が作成されませんでした');
await mkdir(directory, { recursive: true });
const webm = join(directory, 'mechanism.webm');
await rename(await video.path(), webm);
const mp4 = join(directory, 'mechanism.mp4');
const conversion = spawnSync('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
if (conversion.error) throw conversion.error;
if (conversion.status !== 0) throw new Error(`ffmpeg conversion failed: ${conversion.status}`);
await writeFile(join(directory, 'recording.json'), JSON.stringify({ viewport: size, stages: 6, secondsPerStage: 3, secondsOfMotion: 2, loop: true, files: { webm, mp4 } }, null, 2));
log(JSON.stringify({ webm, mp4 }));
