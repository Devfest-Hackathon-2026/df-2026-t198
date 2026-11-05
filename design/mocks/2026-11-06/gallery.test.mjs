import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(name, import.meta.url));
const text = (name) => read(name).toString('utf8');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const html = text('index.html');
const names = ['student', 'session'].flatMap((screen) =>
  ['a', 'b', 'c', 'd'].map((key) => `${screen}-${key}`));
const unescape = (value) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');

test('2画面×4案の画像・読める依頼文・拡大リンクがそろう', () => {
  assert.equal((html.match(/<article /g) ?? []).length, 8);
  assert.equal((html.match(/<details>/g) ?? []).length, 8);
  assert.equal((html.match(/<img /g) ?? []).length, 8);
  const prompts = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((match) => unescape(match[1]));
  for (const [i, name] of names.entries()) {
    assert.equal(prompts[i], text(`prompts/${name}.txt`));
    assert.ok(html.includes(`href="${name}.jpg" target="_blank"`));
    assert.ok(html.includes(`src="${name}.jpg"`));
    assert.ok(html.includes(`href="prompts/${name}.txt"`));
    assert.ok(text('chatgpt.md').includes(`prompts/${name}.txt`));
  }
});

test('8枚は縮めたJPEGで、送った依頼文・参照画像と記録のハッシュが一致する（元のPNGのハッシュは記録に残し、PNGはrepoの外に置く）', () => {
  const records = text('generation.jsonl').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(records.map((record) => record.name), names);
  assert.ok(records.length <= 20);
  for (const [i, record] of records.entries()) {
    assert.equal(record.call, i + 1);
    assert.ok(record.modelVersion.startsWith('gemini-nano-banana-2.1'));
    const image = read(`${record.name}.jpg`);
    assert.equal(image.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.ok(image.length < 600 * 1024);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);
    assert.equal(hash(read(`prompts/${record.name}.txt`)), record.promptSha256);
    assert.equal(hash(read(`references/${record.name.split('-')[0]}.png`)), record.referenceSha256);
    assert.ok(record.usage.totalTokenCount > 0);
  }
});

test('file URLで開けるローカルの参照先があり、外部通信や秘密の値を持たない', () => {
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const path = match[1];
    if (path.startsWith('#')) continue;
    assert.ok(!/^[a-z]+:/i.test(path));
    assert.ok(read(path).length > 0);
  }
  assert.ok(!/<script\b|@import|url\(/i.test(html));
  for (const name of names) {
    const prompt = text(`prompts/${name}.txt`);
    assert.ok(!/Bearer\s|;SID=|AIza[\w-]{20,}|ya29\./.test(prompt));
  }
});
