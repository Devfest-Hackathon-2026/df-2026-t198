import { createHttpServer } from './http.js';

const port = Number(process.env['PORT'] ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = createHttpServer();
server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
