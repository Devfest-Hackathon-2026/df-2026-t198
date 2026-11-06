import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';

const { fetch } = globalThis;

// Run against the Hosting emulator or the deployed site, never Vite's dev server.
const origin = process.env.HOSTING_ORIGIN ?? 'http://127.0.0.1:5002';

for (const path of ['/', '/index.html', '/student', '/session', '/demo-lms', '/session/trial-student', '/session/trial-student/plan']) {
  test(`${path} revalidates the HTML on every visit`, async () => {
    const response = await fetch(new URL(path, origin));
    await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  });
}

test('fingerprinted JavaScript and CSS remain cacheable for a year', async () => {
  const html = await (await fetch(new URL('/', origin))).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)]
    .map((match) => match[1]);
  assert.ok(assets.some((path) => path.endsWith('.js')), 'HTML references JavaScript');
  assert.ok(assets.some((path) => path.endsWith('.css')), 'HTML references CSS');
  for (const path of assets) {
    assert.match(path, /-[\w-]{8,}\.(?:js|css)$/);
    const response = await fetch(new URL(path, origin));
    await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)max-age=31536000(?:,|$)/);
    assert.match(response.headers.get('cache-control'), /(?:^|,\s*)immutable(?:,|$)/);
    assert.doesNotMatch(response.headers.get('content-type'), /text\/html/);
  }
});
