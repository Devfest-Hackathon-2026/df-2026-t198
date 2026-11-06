import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const read = name => readFileSync(new URL(name, import.meta.url));
const text = name => read(name).toString('utf8');
const hash = data => createHash('sha256').update(data).digest('hex');
const names = ['student-a', 'student-b', 'session-a', 'session-b'];
const html = text('index.html');
const unescape = value => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');

test('目的4文と全62要素の判定を、比較ページでも読める', () => {
  const md = text('README.md');
  for (const screen of ['学生の時間割', '面談画面', 'LMSの隅の知らせ', '拡張機能のポップアップ']) {
    assert.ok(md.includes(`- ${screen}：`));
    assert.ok(html.includes(`- ${screen}：`));
  }
  const rows = md.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| 出典'));
  assert.equal(rows.length, 62);
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    assert.equal(cells.length, 7);
    assert.ok(['残す', 'デザインで伝える', '押したときだけ出す', '消す'].includes(cells[5]));
    for (const cell of cells) assert.ok(unescape(html).includes(cell));
  }
});

test('2画面×2案のJPEG・依頼文・拡大リンクと生成記録がそろう', () => {
  const records = text('generation.jsonl').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => record.name), names);
  const attempts = text('attempts.jsonl').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(attempts.length <= 10);
  assert.deepEqual(attempts.map(attempt => attempt.call), attempts.map((_, i) => i + 1));
  assert.deepEqual(attempts.filter(attempt => attempt.status === 'generated').map(attempt => attempt.call), records.map(record => record.call));
  const prompts = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map(match => unescape(match[1]));
  assert.equal((html.match(/<article /g) ?? []).length, 4);
  assert.equal((html.match(/<img /g) ?? []).length, 4);
  for (const [i, name] of names.entries()) {
    const record = records[i];
    const jpeg = read(`${name}.jpg`);
    assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.ok(jpeg.length < 600 * 1024);
    assert.equal(hash(jpeg), record.jpegSha256);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    assert.equal(record.modelVersion, 'gemini-nano-banana-2.1');
    assert.ok(record.usage.totalTokenCount > 0);
    assert.equal(hash(read(`prompts/${name}.txt`)), record.promptSha256);
    assert.equal(prompts[i], text(`prompts/${name}.txt`));
    assert.ok(html.includes(`href="${name}.jpg" target="_blank"`));
    assert.ok(html.includes(`src="${name}.jpg"`));
  }
});

test('画像と依頼文はローカルで開け、比較ページは外部通信しない', () => {
  for (const [, path] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (path.startsWith('#') || path.startsWith('https://')) continue; // 文献リンクは利用者が開く
    assert.ok(statSync(new URL(path, import.meta.url)).isDirectory() || read(path).length > 0);
  }
  assert.ok(!/<script\b|@import|url\(/i.test(html));
  for (const name of names) assert.ok(!/Bearer\s|;SID=|AIza[\w-]{20,}|ya29\./.test(text(`prompts/${name}.txt`)));
});
