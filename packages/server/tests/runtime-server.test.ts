import { serverPort } from '../src/runtime/server.js';
import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function start(mode = 'normal', grace = 1000) {
  const directory = await mkdtemp(join(tmpdir(), 'kadai-runtime-'));
  directories.push(directory);
  const events = join(directory, 'events');
  const child = fork(new URL('./fixtures/runtime-server.mjs', import.meta.url), [events, mode, String(grace)], { silent: true });
  children.push(child);
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? reject(new Error(`unexpected-${signal}`)) : resolve(code));
  });
  const address = await new Promise<{ port: number; host: string }>((resolve, reject) => {
    child.once('message', value => resolve(value as { port: number; host: string }));
    child.once('error', reject);
    child.once('exit', () => reject(new Error('fixture-start-failed')));
  });
  const recorded = async () => (await readFile(events, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  return { child, exited, recorded, address, url: `http://127.0.0.1:${address.port}` };
}
async function waitForRequest(recorded: () => Promise<string[]>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await recorded()).includes('request')) return;
    await delay(10);
  }
  throw new Error('fixture-request-not-received');
}
it('drains an active HTTP response before cleaning resources once across both signals', async () => {
  const { child, exited, recorded, address, url } = await start();
  expect(address.host).toBe('0.0.0.0');
  const response = fetch(url, { headers: { Connection: 'close' } }).then(result => result.text());
  await waitForRequest(recorded);
  child.kill('SIGTERM');
  child.kill('SIGINT');
  expect(await response).toBe('completed');
  expect(await exited).toBe(0);
  expect(await recorded()).toEqual(['request', 'response', 'cleanup', 'cleaned']);
});
it('closes an already idle keep-alive connection before cleanup', async () => {
  const { child, exited, recorded, url } = await start();
  expect(await (await fetch(url)).text()).toBe('completed');
  child.kill('SIGTERM');
  expect(await exited).toBe(0);
  expect(await recorded()).toEqual(['request', 'response', 'cleanup', 'cleaned']);
});
it('exits unsuccessfully when cleanup fails', async () => {
  const { child, exited, recorded } = await start('cleanup-fails');
  child.kill('SIGTERM');
  expect(await exited).toBe(1);
  expect(await recorded()).toEqual(['cleanup']);
});
it('bounds a hung cleanup without relying on the platform to terminate it', async () => {
  const { child, exited, recorded } = await start('cleanup-hangs', 200);
  child.kill('SIGINT');
  expect(await exited).toBe(1);
  expect(await recorded()).toEqual(['cleanup']);
});
it('forcibly closes an unfinished HTTP request at the shutdown deadline', async () => {
  const { child, exited, recorded, url } = await start('request-hangs', 200);
  const response = fetch(url).then(() => 'unexpected-response', () => 'disconnected');
  await waitForRequest(recorded);
  child.kill('SIGTERM');
  expect(await exited).toBe(1);
  expect(await response).toBe('disconnected');
  expect(await recorded()).toEqual(['request']);
});
it.each(['0', '65536', 'not-a-port'])('rejects PORT=%s before initializing the server', port => {
  expect(() => serverPort(port)).toThrow('PORT must be an integer between 1 and 65535.');
});
it('keeps the default and explicitly configured server ports', () => {
  expect(serverPort(undefined)).toBe(8080);
  expect(serverPort('8081')).toBe(8081);
});
