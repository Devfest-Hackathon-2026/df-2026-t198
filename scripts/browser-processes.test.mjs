import assert from 'node:assert/strict';
import process from 'node:process';
import { once } from 'node:events';
import test from 'node:test';
import { localProcesses } from '../packages/web/tests/helpers/local-processes.mjs';

test('handles spawn failure for both completed commands and server readiness', async () => {
  const runner = localProcesses({}, 'browser');
  try {
    const command = runner.start('/nonexistent/kadai-browser-command', [], true);
    await assert.rejects(runner.finish(command), /browser-process-start-failed/);
    const server = runner.start('/nonexistent/kadai-browser-server', [], true);
    await new Promise(resolve => server.once('error', resolve));
    await assert.rejects(runner.ready('http://127.0.0.1:1', server), /browser-server-stopped/);
  } finally { runner.stop(); }
});

test('detects command failure after its exit event and stops tracked servers', async () => {
  const runner = localProcesses(process.env, 'browser');
  try {
    const command = runner.start(process.execPath, ['-e', 'process.exit(23)'], true);
    await once(command, 'exit');
    await assert.rejects(runner.finish(command), /browser-process-failed/);
    const server = runner.start(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], true);
    const exit = once(server, 'exit');
    runner.stop();
    const [code, signal] = await exit;
    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
    await assert.rejects(runner.finish(server), /browser-process-failed/);
  } finally { runner.stop(); }
});
