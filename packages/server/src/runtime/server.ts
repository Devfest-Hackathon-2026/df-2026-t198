import type { Server } from 'node:http';

export function serverPort(value: string | undefined) {
  const port = Number(value ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export function startServer(server: Server, cleanup: () => Promise<void>, port: number, graceMs = 9000) {
  let closing = false;
  const shutdown = (code = 0) => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, graceMs);
    const finish = (status: number) => {
      clearTimeout(deadline);
      process.exit(status);
    };
    server.close(error => {
      void Promise.resolve().then(cleanup).then(
        () => finish(error ? 1 : code),
        () => finish(1),
      );
    });
  };
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
  server.once('error', () => shutdown(1));
  server.listen(port, '0.0.0.0');
}
