import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { startServer } from '../../src/runtime/server.ts';

const [events, mode, grace] = process.argv.slice(2);
const record = value => appendFileSync(events, `${value}\n`);
const server = createServer((request, response) => {
  record('request');
  if (mode === 'request-hangs') return;
  void setTimeout(100).then(() => {
    response.end('completed');
    record('response');
  });
});
startServer(server, async () => {
  record('cleanup');
  if (mode === 'cleanup-fails') throw new Error('fixture-cleanup-failure');
  if (mode === 'cleanup-hangs') await new Promise(() => {});
  await setTimeout(100);
  record('cleaned');
}, 0, Number(grace));
server.on('listening', () => {
  const address = server.address();
  process.send({ port: address.port, host: address.address });
});
