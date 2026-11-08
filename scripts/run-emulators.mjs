import process from 'node:process';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function emulatorOptions(args, env) {
  const forwarded = args.filter(arg => arg !== '--config-from-env');
  if (args.includes('--config-from-env')) forwarded.unshift('--config', env.KADAI_FIREBASE_CONFIG || 'firebase.json');
  const javaPath = `/opt/homebrew/opt/openjdk@21/bin:${env.JAVA_HOME_21_X64 ? `${env.JAVA_HOME_21_X64}/bin:` : ''}`;
  return { args: ['emulators:exec', ...forwarded], env: { ...env, PATH: `${javaPath}${env.PATH ?? ''}` } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { args, env } = emulatorOptions(process.argv.slice(2), process.env);
  const child = spawn('firebase', args, { env, stdio: 'inherit' });
  const forwardSignal = signal => child.kill(signal);
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const removeHandlers = () => {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  };
  child.once('error', () => {
    removeHandlers();
    process.stderr.write('firebase-emulators-start-failed\n');
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    removeHandlers();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
