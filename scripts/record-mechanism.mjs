import process from 'node:process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from 'node:console';

// Start a local web dev/preview first. Video comes from the browser; audio is
// captured from the same Web Audio graph and muxed into the MP4 with ffmpeg.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5173';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local-preview-required');
const directory = resolve(process.env.MECHANISM_RECORD_DIR || 'out/issue-262');
await mkdir(directory, { recursive: true });
const size = { width: 1280, height: 720 };
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let video;
let sound;
try {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: directory, size }, reducedMotion: 'no-preference' });
  // Playwright's video recorder has no audio track. Tap each gain that is sent
  // to the speakers, so the recording contains the cues that really played.
  await context.addInitScript(() => {
    const NativeAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        const destination = this.createMediaStreamDestination();
        // Keep silent intervals in the stream so WebM does not trim its ends.
        const silence = this.createConstantSource();
        silence.offset.value = 0;
        silence.connect(destination);
        silence.start();
        const started = performance.now();
        const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks = [];
        const cues = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.start();
        const createGain = this.createGain.bind(this);
        this.createGain = () => {
          const gain = createGain();
          const connect = gain.connect.bind(gain);
          gain.connect = (target, ...rest) => {
            if (target === this.destination) connect(destination);
            return connect(target, ...rest);
          };
          return gain;
        };
        const createOscillator = this.createOscillator.bind(this);
        this.createOscillator = () => {
          const oscillator = createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = time => { cues.push({ frequency: oscillator.frequency.value, audioTime: time }); start(time); };
          return oscillator;
        };
        globalThis.__mechanismAudio = { stop: () => new Promise(resolve => {
          recorder.onstop = async () => {
            const reader = new FileReader();
            reader.onload = () => resolve({ base64: String(reader.result).split(',')[1], cues, state: this.state, wallSeconds: (performance.now() - started) / 1000 });
            reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType }));
          };
          recorder.stop();
        }) };
      }
    };
  });
  const page = await context.newPage();
  video = page.video();
  await page.mouse.move(0, 0);
  // Let fonts finish before starting the timeline.
  await page.goto(`${base}/slides/mechanism?sound=1`);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.sound === 'true');
  await page.getByRole('button', { name: '再生する', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => globalThis.document.querySelector('.mechanism')?.dataset.finished === 'true', null, { timeout: 45000 });
  await page.waitForTimeout(600);
  sound = await page.evaluate(() => globalThis.__mechanismAudio.stop());
  await context.close();
} finally { await browser.close(); }
if (!video) throw new Error('録画が作成されませんでした');
const webm = join(directory, 'mechanism.webm');
await rename(await video.path(), webm);
const audio = join(directory, 'mechanism-audio.webm');
if (!sound?.base64 || !sound.cues.length || sound.state !== 'running') throw new Error('Web Audioの出力を録音できませんでした');
await writeFile(audio, Buffer.from(sound.base64, 'base64'));
function duration(path) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error('ffprobeで録画の長さを確認できませんでした');
  return Number(probe.stdout.trim());
}
// Both recorders stop on the final frame. Match their ends to account for the
// short blank video lead-in before the page constructs its AudioContext.
const audioDuration = duration(audio);
if (Math.abs(audioDuration - sound.wallSeconds) > .5) throw new Error('録音の無音区間が欠けています');
const offset = Math.max(0, duration(webm) - audioDuration);
if (offset > 2) throw new Error('映像と音声の開始時刻を合わせられませんでした');
const mp4 = join(directory, 'mechanism.mp4');
const conversion = spawnSync('ffmpeg', ['-y', '-i', webm, '-itsoffset', String(offset), '-i', audio,
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '128k',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (conversion.status !== 0) throw new Error('ffmpegで音声つきMP4に変換できませんでした');
await writeFile(join(directory, 'recording.json'), JSON.stringify({ viewport: size, stages: 7, timelineMs: 32400,
  audioCapture: 'Web Audio output via MediaStreamDestination', audioOffsetSeconds: offset, audioDurationSeconds: audioDuration, recordedWallSeconds: sound.wallSeconds, cues: sound.cues,
  files: { webm, audio, mp4 }, durationSeconds: duration(mp4) }, null, 2));
log(JSON.stringify({ mp4, audio: true, oscillators: sound.cues.length, viewport: size }));
