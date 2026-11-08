import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export function localProcesses(env, prefix) {
  const children = [];
  const errors = new WeakMap();
  function start(command, args, quiet = false) {
    const child = spawn(command, args, { env, stdio: quiet ? 'ignore' : 'inherit' });
    child.once('error', error => errors.set(child, error));
    children.push(child);
    return child;
  }
  function finish(child) {
    return new Promise((resolve, reject) => {
      const failed = () => reject(new Error(`${prefix}-process-failed`));
      if (errors.has(child)) return reject(new Error(`${prefix}-process-start-failed`));
      if (child.exitCode !== null || child.signalCode !== null) return child.exitCode === 0 ? resolve() : failed();
      child.once('error', () => reject(new Error(`${prefix}-process-start-failed`)));
      child.once('exit', code => code === 0 ? resolve() : failed());
    });
  }
  async function ready(url, child) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (errors.has(child) || child.exitCode !== null || child.signalCode !== null) throw new Error(`${prefix}-server-stopped`);
      if ((await globalThis.fetch(url).catch(() => null))?.ok) return;
      await new Promise(resolve => globalThis.setTimeout(resolve, 100));
    }
    throw new Error(`${prefix}-server-not-ready`);
  }
  async function checkPorts(ports) {
    for (const port of ports) await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(new Error(`${prefix}-port-in-use`)));
      probe.listen(Number(port), '127.0.0.1', () => probe.close(resolve));
    });
  }
  function stop() {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  }
  return { start, finish, ready, checkPorts, stop };
}
